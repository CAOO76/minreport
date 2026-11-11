import { randomUUID } from 'crypto';
import { type NextFunction, Router, type Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import multer from 'multer';
import { db, storage } from '../../../config/firebase';
import { env } from '../../../config/env';
import { AuditLedger } from '../../../core/audit-ledger';
import { CasStorageService } from '../../../core/media/CasStorageService';
import { ConfidentialityAirlockService } from '../../../core/privacy/ConfidentialityAirlockService';
import { AISwarmUnavailableError } from '../../../core/resilient-ai-client';
import type { ScopedRequest } from '../../../middleware/sessionScope';
import { assertSafeExternalUrl, safeFetchExternal, SSRFBlockedError } from '../../../utils/ssrfGuard';
import {
    assistItemEdit,
    assistRejection,
    correctManualItemText,
    evolveItemContent,
} from '../services/AiAssistService';
import { resolveAssetSymbology } from '../services/AssetResolverService';
import { validateCatalogProfileGate } from '../services/CatalogUpsertService';
import {
    type BenchmarkMetricKind,
    CollectiveBenchmarkService,
} from '../services/CollectiveBenchmarkService';
import { buildAndPersistAssetSymbologyPack } from '../services/EquipmentSymbologyPackBuilder';
import {
    buildAndPersistEquipmentCostMatrix,
    compileEquipmentCostMatrixFromPillars,
} from '../services/EquipmentCostMatrixCompiler';
import {
    huntVaultItem,
    reconcileAssetSidebarProfileFromVault,
    scheduleDebouncedAssetSymbologyPackRebuild,
} from '../services/ItemHunterService';
import {
    computePillarContentDigestSha256,
    computePillarStructureDigestSha256,
    computeVaultMerkleRootSha256,
    ensureFichaTecnicaConsumptionBaseItem,
    ensurePautaMantencionWearAndRodadoBaseItem,
    isPillarMerkleChainEvolved,
    itemizeSinglePillar,
    sortAndReindexPillarItems,
    suggestComplementaryPillarItems,
} from '../services/ItemizerService';
import {
    computeFactFingerprint,
    injectVerifiedInlineSymbology,
    verifyAndNormalizeTechnicalUnits,
} from '../services/NeuroSymbolicVerifier';
import { OpermaqManualPublisher } from '../services/OpermaqManualPublisher';
import { createEmptyKnowledgeVault, PILLAR_LABELS } from '../services/pillarAgents';
import { OfficialEquipmentPhotoService } from '../services/OfficialEquipmentPhotoService';
import { SegmentedDocumentProcessorService } from '../services/SegmentedDocumentProcessorService';
import { VaultPersistenceService } from '../services/VaultPersistenceService';
import {
    drawStandardIcon,
    generateBrandVariant,
    getMasterSymbols,
    getPendingSymbols,
    isValidHitlSymbologyWord,
    registerBrandVariant,
    registerStandardIcon,
    searchIsoIconFromWikimedia,
    uploadManualVariant,
    uploadStandardIcon,
} from '../services/SymbologyService';
import { buildHuntTaskId, enqueueItemHuntTask, isHuntTaskActivelyRunning } from '../services/TaskQueueService';
import { ensureUniversalSymbologySeeded } from '../services/UniversalSymbologySeedService';
import {
    injectExplicitFigureCitationInSection,
    parsePendingMarker,
    sanitizeMarkdownFiguresAndBrokenMarkers,
    sanitizeMarkdownLabel,
    splitMarkdownSections,
    tokenContainment,
} from '../services/PendingFigureMarkers';
import {
    filterFiguresReferencedInMarkdown,
    formatFigureMarkdownBlock,
    mergeDeduplicatedFigures,
    reconcileSectionFiguresAndPendingMarkers,
} from '../services/VaultReconciliationService';
import { processVaultChat } from '../services/vaultChatService';
import {
    type AdHocManualProfileId,
    type ChatMessage,
    type ExtractedFigureRef,
    HITL_CONFIRM_KEYWORD,
    PILLAR_PREREQUISITE_MAP,
    type PillarId,
    ReviewContributionBodySchema,
    VALID_PILLAR_IDS,
} from '../types/vault.types';
import { z } from 'zod';

/**
 * OPERMAQ — Vault Routes (Etapas 2, 3 y 4: Itemizado, Caza On-Demand, Curaduría HITL y Simbología ISO 7000)
 *
 * Subordinación 100% a MINREPORT Core (`req.opermaqContext`):
 * - Cero gestión de usuarios, contratos o ledger paralelo (`vault_audit_logs` eliminado).
 * - Confirmación HITL unificada bajo palabra clave `"ACTUALIZAR"` (`GEMINI.md §3.8`).
 */

const MAX_VAULT_UPLOAD_BYTES = 64 * 1024 * 1024; // Tope seguro 64 MB

const vaultRouter = Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_VAULT_UPLOAD_BYTES },
});
const uploadDocument = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_VAULT_UPLOAD_BYTES },
});

const MAX_DOCUMENT_INGEST_CONCURRENCY = 2;
let activeDocumentIngestions = 0;
const documentIngestQueue: Array<() => void> = [];

async function withDocumentIngestSemaphore<T>(task: () => Promise<T>): Promise<T> {
    if (activeDocumentIngestions >= MAX_DOCUMENT_INGEST_CONCURRENCY) {
        await new Promise<void>((resolve) => {
            documentIngestQueue.push(resolve);
        });
    }
    activeDocumentIngestions++;
    try {
        return await task();
    } finally {
        activeDocumentIngestions = Math.max(0, activeDocumentIngestions - 1);
        const next = documentIngestQueue.shift();
        if (next) next();
    }
}

function requireCurateAI(req: ScopedRequest, res: Response, next: NextFunction) {
    if (!req.opermaqContext?.capabilities?.canCurateAI) {
        return res.status(403).json({
            error: 'FORBIDDEN_GLOBAL_CURATION',
            message: 'Permisos insuficientes: se requiere rol con privilegio de curaduría global OEM (DEV_ROOT, SUPER_ADMIN o TEST_PILOT).',
        });
    }
    return next();
}

function handleVaultError(res: Response, err: unknown, fallbackMessage: string) {
    console.error(`[VAULT-ROUTE-ERROR] ${fallbackMessage}:`, err);
    if (err instanceof SSRFBlockedError) {
        return res.status(400).json({
            error: err.code,
            message: err.message,
        });
    }
    if (err instanceof AISwarmUnavailableError) {
        return res.status(503).json({
            error: err.code,
            message: err.message,
        });
    }
    const anyErr = err as any;
    const status = typeof anyErr?.statusCode === 'number' ? anyErr.statusCode : 500;
    return res.status(status).json({
        error: anyErr?.message || fallbackMessage,
        ...(anyErr?.missingFields ? { missingFields: anyErr.missingFields } : {}),
    });
}

async function checkVaultNotSealed(req: ScopedRequest, res: Response, next: NextFunction) {
    const globalAssetId =
        req.body?.globalAssetId || req.params?.globalAssetId || req.query?.globalAssetId;
    if (!globalAssetId || typeof globalAssetId !== 'string') {
        return next();
    }

    try {
        const snap = await db.collection('global_asset_catalog').doc(globalAssetId).get();
        (req as any).catalogDocSnap = snap;
        const data = snap.data();
        if (
            snap.exists &&
            (data?.isSealed === true ||
                data?.is_sealed === true ||
                data?.knowledge_vault?.is_sealed === true)
        ) {
            return res.status(403).json({
                error: 'VAULT_SEALED',
                message: 'La bóveda técnica está sellada y no admite mutaciones sin desbloqueo previo.',
            });
        }
        return next();
    } catch {
        return next();
    }
}

function reindexPillarItems(items: any[]): any[] {
    const active = items.filter((it) => !it.is_discarded).sort((a, b) => (a.order || 0) - (b.order || 0));
    const discarded = items.filter((it) => it.is_discarded).sort((a, b) => (a.order || 0) - (b.order || 0));
    active.forEach((it, idx) => {
        it.order = idx + 1;
    });
    discarded.forEach((it, idx) => {
        it.order = active.length + idx + 1;
    });
    return [...active, ...discarded];
}

async function sanitizeAndEnrichItemContentForSave(
    rawContent: string,
    pillarId: PillarId
): Promise<{ content: string; symbologyRefs: string[] }> {
    const unitChecked = verifyAndNormalizeTechnicalUnits(String(rawContent || ''));
    const symbologyRes = await injectVerifiedInlineSymbology(unitChecked.normalizedMarkdown, {
        pillarId,
    });
    return {
        content: symbologyRes.enrichedMarkdown,
        symbologyRefs: symbologyRes.detectedConceptIds,
    };
}

/**
 * Orquestador de Cadena Indirecta Multi-Pilar (`propagateItemContentMutationEffects`):
 * Ejecutado tras cualquier mutación en los editores de contenido de la columna derecha
 * (`apply-assist-proposal`, `evolve-item`, `update-item-content`, `rollback-item-version`,
 * `update-item-approval-state`, `resolve-pending-figure`):
 * 1. Calcula `content_digest_sha256` del pilar y actualiza `vault_merkle_root_sha256`.
 * 2. Sincroniza el contenido curado en `vault_corpus_chunks` (`southamerica-west1`) para retroalimentar el RAG soberano.
 * 3. Si `pillarId === 'ficha_tecnica'`, reconcilia automáticamente la Ficha Lateral Izquierda y la Matriz Energética.
 */
async function propagateItemContentMutationEffects(params: {
    globalAssetId: string;
    pillarId: PillarId;
    itemId: string;
    updatedItem: any;
    updatedItems: any[];
    existingVault: Record<string, any> | undefined;
}): Promise<{ contentDigestSha256: string | null; vaultMerkleRootSha256: string | null }> {
    const { globalAssetId, pillarId, itemId, updatedItem, updatedItems, existingVault } = params;
    const docRef = db.collection('global_asset_catalog').doc(globalAssetId);

    const contentDigestSha256 = computePillarContentDigestSha256(updatedItems);
    const updatedPillarDoc = {
        ...(existingVault?.[pillarId] || {
            pillar_id: pillarId,
            status: 'COMPLETED',
            itemize_status: 'COMPLETED',
            make_model: '',
        }),
        pillar_id: pillarId,
        items: updatedItems,
        content_digest_sha256: contentDigestSha256,
        updated_at: new Date().toISOString(),
    };
    const nextVault = {
        ...(existingVault || {}),
        [pillarId]: updatedPillarDoc,
    };
    const vaultMerkleRootSha256 = computeVaultMerkleRootSha256(nextVault);

    await VaultPersistenceService.savePillarDocument({
        globalAssetId,
        pillarId,
        pillarDoc: updatedPillarDoc as any,
        vaultMerkleRootSha256,
    });

    if (updatedItem && typeof updatedItem.content === 'string' && updatedItem.content.trim().length > 0) {
        const chunkId = `curated_${pillarId}_${itemId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
        await docRef
            .collection('vault_corpus_chunks')
            .doc(chunkId)
            .set(
                {
                    chunk_id: chunkId,
                    pillar_id: pillarId,
                    item_id: itemId,
                    chapter_title: String(updatedItem.title || itemId),
                    section: String(updatedItem.section || ''),
                    source_filename: 'Curaduría Técnica HITL Soberana (southamerica-west1)',
                    markdown_es: updatedItem.content,
                    is_curated_hitl: true,
                    is_human_locked: Boolean(updatedItem.is_human_locked),
                    estado_aprobacion: String(updatedItem.estado_aprobacion || 'GENERADO_IA'),
                    updated_at: new Date().toISOString(),
                },
                { merge: true }
            )
            .catch(() => undefined);
    }

    if (pillarId === 'ficha_tecnica') {
        await reconcileAssetSidebarProfileFromVault(globalAssetId, {
            allowGroundedEnrichmentIfNeeded: false,
            preferVaultMarkdownOverExisting: true,
        }).catch(() => null);
    }

    if (pillarId === 'ficha_tecnica' || pillarId === 'pauta_mantencion') {
        await buildAndPersistEquipmentCostMatrix(globalAssetId).catch(() => null);
    }

    scheduleDebouncedAssetSymbologyPackRebuild(globalAssetId);

    return { contentDigestSha256, vaultMerkleRootSha256 };
}

// ── ETAPA 2: INICIALIZACIÓN E ITEMIZADO ON-DEMAND POR PILAR ──────────────────

vaultRouter.post('/initialize-vault', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const { globalAssetId } = req.body || {};
    if (!globalAssetId) {
        return res.status(400).json({ error: 'globalAssetId es requerido.' });
    }

    try {
        const docRef = db.collection('global_asset_catalog').doc(String(globalAssetId));
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
            String(globalAssetId),
            (req as any).catalogDocSnap
        );
        if (!hydrated.exists || !hydrated.data) {
            return res.status(404).json({ error: 'Activo no encontrado en global_asset_catalog.' });
        }

        const data = hydrated.data;
        const hasVaultKeys =
            data.knowledge_vault &&
            VALID_PILLAR_IDS.some((pid) => Boolean(data.knowledge_vault?.[pid]));

        if (!hasVaultKeys) {
            const makeModel =
                data.make_model || `${data.make_oficial || data.make || ''} ${data.model_oficial || data.model || ''}`.trim();
            await docRef.update({
                knowledge_vault: createEmptyKnowledgeVault(makeModel),
                vault_partition_version: 3,
                updatedAt: Date.now(),
            });
        } else {
            const fichaDoc = data.knowledge_vault?.ficha_tecnica;
            const fichaItems = Array.isArray(fichaDoc?.items) ? fichaDoc.items : [];
            if (fichaItems.length > 0 && !data.is_sealed && !data.isSealed && !data.knowledge_vault?.is_sealed) {
                const healed = ensureFichaTecnicaConsumptionBaseItem({
                    items: fichaItems,
                    typeDoc: {
                        type_key: String(data.equipment_type_key || data.tipo_equipo || ''),
                        canonical_type_es: String(data.tipo_equipo || 'MAQUINARIA INDUSTRIAL'),
                        categoria_equipo: String(data.categoria_equipo || 'MAQUINARIA'),
                        physical_traits: data.physical_traits,
                    } as any,
                    defaultSources: Array.isArray(fichaDoc?.classified_sources_itemized)
                        ? fichaDoc.classified_sources_itemized
                        : [],
                });
                if (healed.modified) {
                    const structureDigest = computePillarStructureDigestSha256(healed.items, null) || '';
                    await VaultPersistenceService.savePillarDocument({
                        globalAssetId: String(globalAssetId),
                        pillarId: 'ficha_tecnica',
                        pillarDoc: {
                            ...fichaDoc,
                            pillar_id: 'ficha_tecnica',
                            items: healed.items,
                            structure_digest_sha256: structureDigest,
                            updated_at: new Date().toISOString(),
                        },
                    });
                }
            }

            const pmDoc = data.knowledge_vault?.pauta_mantencion;
            const pmItems = Array.isArray(pmDoc?.items) ? pmDoc.items : [];
            if (pmItems.length > 0 && !data.is_sealed && !data.isSealed && !data.knowledge_vault?.is_sealed) {
                const healedPm = ensurePautaMantencionWearAndRodadoBaseItem({
                    items: pmItems,
                    typeDoc: {
                        type_key: String(data.equipment_type_key || data.tipo_equipo || ''),
                        canonical_type_es: String(data.tipo_equipo || 'MAQUINARIA INDUSTRIAL'),
                        categoria_equipo: String(data.categoria_equipo || 'MAQUINARIA'),
                        physical_traits: data.physical_traits,
                    } as any,
                    defaultSources: Array.isArray(pmDoc?.classified_sources_itemized)
                        ? pmDoc.classified_sources_itemized
                        : [],
                });
                if (healedPm.modified) {
                    const pmStructureDigest =
                        computePillarStructureDigestSha256(
                            healedPm.items,
                            pmDoc?.parent_pillar_digest_sha256 || null
                        ) || '';
                    await VaultPersistenceService.savePillarDocument({
                        globalAssetId: String(globalAssetId),
                        pillarId: 'pauta_mantencion',
                        pillarDoc: {
                            ...pmDoc,
                            pillar_id: 'pauta_mantencion',
                            items: healedPm.items,
                            structure_digest_sha256: pmStructureDigest,
                            updated_at: new Date().toISOString(),
                        },
                    });
                }
            }
        }

        if (!data.is_sealed && !data.isSealed && !data.knowledge_vault?.is_sealed) {
            await buildAndPersistEquipmentCostMatrix(String(globalAssetId)).catch(() => null);
        }

        return res.status(200).json({
            success: true,
            message: 'Estructura base de 5 pilares inicializada en IDLE.',
        });
    } catch (err) {
        return handleVaultError(res, err, 'Error inicializando bóveda técnica.');
    }
});

vaultRouter.post('/itemize-pillar', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const schema = z.object({
        globalAssetId: z.string().min(1),
        pillarId: z.enum([
            'ficha_tecnica',
            'manual_operaciones',
            'pauta_mantencion',
            'matriz_riesgos',
            'checklist_pre_op',
        ]),
        forceSmartMerge: z.boolean().optional(),
        confirmWord: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Parámetros inválidos (globalAssetId, pillarId).' });
    }

    const { globalAssetId, pillarId, forceSmartMerge, confirmWord } = parsed.data;

    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
            globalAssetId,
            (req as any).catalogDocSnap
        );
        if (!hydrated.exists || !hydrated.data) {
            return res.status(404).json({ error: 'Catálogo no encontrado.' });
        }
        const data = hydrated.data;
        const gate = validateCatalogProfileGate(data);
        if (!gate.valid) {
            return res.status(422).json({
                error: 'PERFIL_INCOMPLETO',
                message: 'Complete el perfil técnico base antes de itemizar este pilar.',
                missingFields: gate.missingFields,
            });
        }

        const pillar = data.knowledge_vault?.[pillarId];
        const isAuthorizedSmartMerge =
            forceSmartMerge === true &&
            String(confirmWord || '').trim().toUpperCase() === HITL_CONFIRM_KEYWORD;

        // Compuerta de secuencia lógica de 5 pilares (`01 ➔ 02 ➔ 03 ➔ 04 ➔ 05`)
        const prerequisitePillarId = PILLAR_PREREQUISITE_MAP[pillarId];
        let isParentPillarEvolved = false;
        if (prerequisitePillarId) {
            const prereqPillar = data.knowledge_vault?.[prerequisitePillarId];
            const prereqActiveItems = Array.isArray(prereqPillar?.items)
                ? prereqPillar.items.filter((it: any) => !it?.is_discarded)
                : [];
            if (prereqActiveItems.length === 0) {
                const prereqLabel = PILLAR_LABELS[prerequisitePillarId] || prerequisitePillarId;
                const currentLabel = PILLAR_LABELS[pillarId] || pillarId;
                return res.status(409).json({
                    error: 'PREREQUISITE_PILLAR_NOT_ITEMIZED',
                    code: 'SECUENCIA_PILAR_BLOQUEADA',
                    prerequisitePillarId,
                    message: `Secuencia de 5 Pilares: Debe itemizar primero "${prereqLabel}" antes de itemizar "${currentLabel}".`,
                });
            }
            if (isPillarMerkleChainEvolved(data.knowledge_vault, pillarId)) {
                isParentPillarEvolved = true;
            }
        }

        if (pillar?.itemize_status === 'COMPLETED' && !isAuthorizedSmartMerge && !isParentPillarEvolved) {
            return res.status(409).json({
                error: 'ALREADY_ITEMIZED',
                message:
                    'El pilar ya fue itemizado. Para sincronizar y fusionar nuevos subsistemas sin borrar datos existentes, autorice con "ACTUALIZAR".',
            });
        }
        if (pillar?.itemize_status === 'GENERATING') {
            const startedMs = pillar.started_at ? new Date(pillar.started_at).getTime() : 0;
            if (startedMs > 0 && Date.now() - startedMs < 45 * 1000) {
                return res.status(409).json({
                    error: 'ALREADY_ITEMIZED',
                    message: 'El pilar se encuentra en itemización activa.',
                });
            }
        }

        const result = await itemizeSinglePillar(globalAssetId, pillarId, {
            actorId: ctx.actorId,
            actorEmail: ctx.actorEmail,
            forceSmartMerge: isAuthorizedSmartMerge,
        });
        return res.status(200).json({
            success: true,
            items: result.items,
            classified_sources: result.classified_sources,
            preservedItemsCount: result.preservedItemsCount ?? 0,
            addedItemsCount: result.addedItemsCount ?? result.totalItems,
            message: `Pilar ${pillarId} itemizado (${result.totalItems} ítems activos).`,
        });
    } catch (err) {
        return handleVaultError(res, err, 'Error ejecutando itemizado del pilar.');
    }
});

vaultRouter.post(
    '/asset-image',
    requireCurateAI,
    checkVaultNotSealed,
    async (req: ScopedRequest, res: Response) => {
        const ctx = req.opermaqContext!;
        const schema = z.object({
            globalAssetId: z.string().min(1),
            tenantAssetId: z.string().optional(),
            imageUrl: z.string().nullable(),
            imagePath: z.string().nullable().optional(),
            imageMetadata: z.record(z.string(), z.any()).nullable().optional(),
            fotoMediaTelemetry: z.record(z.string(), z.any()).nullable().optional(),
            fotoVlmAuditVersion: z.number().int().nullable().optional(),
            officialPhotoCandidates: z.array(z.record(z.string(), z.any())).optional(),
        });

        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Parámetros de imagen inválidos.' });
        }

        const {
            globalAssetId,
            tenantAssetId,
            imageUrl,
            imagePath,
            imageMetadata,
            fotoMediaTelemetry,
            fotoVlmAuditVersion,
            officialPhotoCandidates,
        } = parsed.data;
        try {
            const docRef = db.collection('global_asset_catalog').doc(globalAssetId);
            const snap = await docRef.get();
            if (!snap.exists) {
                return res.status(404).json({ error: 'Activo no encontrado en catálogo.' });
            }
            const data = snap.data() || {};
            const nextSpecs = {
                ...(data.specifications || {}),
                imageUrl: imageUrl ?? null,
                imagePath: imagePath ?? null,
                imageMetadata: imageMetadata ?? null,
            };

            const existingPool = Array.isArray(data.official_photo_candidates)
                ? data.official_photo_candidates
                : [];
            const incomingPool = Array.isArray(officialPhotoCandidates) ? officialPhotoCandidates : [];
            const mergedCandidates: Record<string, any>[] = [];
            const seenShas = new Set<string>();
            for (const cand of [...incomingPool, ...existingPool]) {
                const sha = String(cand?.sha256 || '').trim();
                const preview = String(cand?.preview_url || '').trim();
                if (sha && preview && !seenShas.has(sha) && mergedCandidates.length < 12) {
                    seenShas.add(sha);
                    mergedCandidates.push(cand);
                }
            }

            const matchedAuditCandidate = imageUrl
                ? mergedCandidates.find(
                      (c) =>
                          c &&
                          (c.preview_url === imageUrl ||
                              (fotoMediaTelemetry?.sha256 && c.sha256 === fotoMediaTelemetry.sha256))
                  )
                : null;
            const resolvedPhotoAuditVersion: number | null = !imageUrl
                ? null
                : typeof fotoVlmAuditVersion === 'number'
                ? fotoVlmAuditVersion
                : typeof matchedAuditCandidate?.vlm_audit_version === 'number'
                ? matchedAuditCandidate.vlm_audit_version
                : typeof data.foto_vlm_audit_version === 'number'
                ? data.foto_vlm_audit_version
                : null;

            const nowMs = Date.now();
            const updatePayload: Record<string, any> = {
                foto_url: imageUrl ?? '',
                foto_media_telemetry: fotoMediaTelemetry ?? imageMetadata ?? null,
                foto_vlm_audit_version: resolvedPhotoAuditVersion,
                specifications: nextSpecs,
                updatedAt: nowMs,
            };
            if (mergedCandidates.length > 0) {
                updatePayload.official_photo_candidates = mergedCandidates;
            }
            await docRef.update(updatePayload);

            if (tenantAssetId && tenantAssetId !== globalAssetId) {
                await db
                    .collection('tenant_assets')
                    .doc(tenantAssetId)
                    .update({
                        foto_url: imageUrl ?? '',
                        foto_media_telemetry: fotoMediaTelemetry ?? imageMetadata ?? null,
                        foto_vlm_audit_version: resolvedPhotoAuditVersion,
                        updatedAt: nowMs,
                    })
                    .catch(() => undefined);
            }

            void AuditLedger.record({
                tenantId: 'GLOBAL_OEM',
                actorUid: ctx.actorId,
                actorEmail: ctx.actorEmail,
                module: 'opermaq',
                action: imageUrl ? 'VAULT_ASSET_IMAGE_UPDATED' : 'VAULT_ASSET_IMAGE_REMOVED',
                targetEntity: `global_asset_catalog/${globalAssetId}`,
                details: {
                    globalAssetId,
                    hasImage: Boolean(imageUrl),
                    imagePath: imagePath || null,
                    telemetry: fotoMediaTelemetry || null,
                },
            }).catch(() => undefined);

            return res.status(200).json({ success: true, specifications: nextSpecs });
        } catch (err) {
            return handleVaultError(res, err, 'Error actualizando fotografía oficial del activo.');
        }
    }
);

vaultRouter.post(
    '/hunt-official-photo',
    requireCurateAI,
    checkVaultNotSealed,
    async (req: ScopedRequest, res: Response) => {
        const { globalAssetId, refreshAttempt, excludeSha256s } = req.body || {};
        if (!globalAssetId || typeof globalAssetId !== 'string') {
            return res.status(400).json({ error: 'globalAssetId es requerido.' });
        }
        try {
            const candidates = await OfficialEquipmentPhotoService.huntOfficialEquipmentPhotos({
                globalAssetId,
                actorId: req.opermaqContext?.actorId,
                actorEmail: req.opermaqContext?.actorEmail,
                refreshAttempt: typeof refreshAttempt === 'number' ? refreshAttempt : 0,
                excludeSha256s: Array.isArray(excludeSha256s) ? excludeSha256s : [],
            });
            return res.status(200).json({ success: true, candidates });
        } catch (err) {
            return handleVaultError(res, err, 'Error ejecutando caza asistida de fotografía oficial.');
        }
    }
);

vaultRouter.post(
    '/verify-manual-official-photo',
    requireCurateAI,
    checkVaultNotSealed,
    upload.single('file'),
    async (req: ScopedRequest, res: Response) => {
        const globalAssetId = (req.body?.globalAssetId || req.query?.globalAssetId) as string;
        if (!globalAssetId) {
            return res.status(400).json({ error: 'globalAssetId es requerido.' });
        }

        let fileBuffer: Buffer | null = null;
        let mimeType = 'image/jpeg';
        let fileName = 'manual_upload.webp';

        if (req.file) {
            fileBuffer = req.file.buffer;
            mimeType = req.file.mimetype || 'image/jpeg';
            fileName = req.file.originalname || 'manual_photo.webp';
        } else if (req.body?.imageUrl && typeof req.body.imageUrl === 'string') {
            const rawUrl = req.body.imageUrl.trim();
            const safeUrl = await assertSafeExternalUrl(rawUrl).catch(() => null);
            if (safeUrl) {
                const fetched = await safeFetchExternal(safeUrl.toString(), {
                    maxBytes: 12 * 1024 * 1024,
                    headers: { 'User-Agent': 'MINREPORT-OfficialPhotoBot/1.0' },
                }).catch(() => null);
                if (fetched && fetched.ok) {
                    const ab = await fetched.arrayBuffer();
                    fileBuffer = Buffer.from(ab);
                    mimeType = (fetched.headers.get('content-type') || '').split(';')[0].trim() || 'image/jpeg';
                    fileName = safeUrl.pathname.split('/').pop() || 'remote_photo.webp';
                }
            }
        }

        if (!fileBuffer || fileBuffer.length < 50) {
            return res.status(400).json({ error: 'Archivo de imagen requerido para verificación.' });
        }

        try {
            const result = await OfficialEquipmentPhotoService.verifyManualOfficialEquipmentPhoto({
                globalAssetId,
                fileBuffer,
                mimeType,
                fileName,
                actorId: req.opermaqContext?.actorId,
            });
            return res.status(200).json({ success: true, ...result });
        } catch (err) {
            return handleVaultError(res, err, 'Error auditando fotografía manual.');
        }
    }
);

vaultRouter.post(
    '/reframe-official-photo',
    requireCurateAI,
    checkVaultNotSealed,
    async (req: ScopedRequest, res: Response) => {
        const { globalAssetId } = req.body || {};
        if (!globalAssetId || typeof globalAssetId !== 'string') {
            return res.status(400).json({ error: 'globalAssetId es requerido.' });
        }

        try {
            const docRef = db.collection('global_asset_catalog').doc(globalAssetId);
            const snap = await docRef.get();
            if (!snap.exists) {
                return res.status(404).json({ error: 'Activo no encontrado.' });
            }

            const data = snap.data() || {};
            const currentUrl = data.foto_url;
            if (!currentUrl) {
                return res.status(400).json({ error: 'El activo no tiene fotografía cargada para re-encuadrar.' });
            }

            // Descargar imagen actual (CAS por ruta directa, proxy /api/media/blob o URL externa)
            let imgBuffer: Buffer | null = null;
            const casDirectMatch = String(currentUrl).match(/(cas_blobs\/[^?#]+)/);
            const casProxyMatch = String(currentUrl).match(/\/api\/media\/blob\/([^/?#]+)\/([^/?#]+)/);
            const resolvedCasPath = casDirectMatch
                ? casDirectMatch[1]
                : casProxyMatch
                  ? `cas_blobs/${casProxyMatch[1]}/${casProxyMatch[2]}`
                  : null;
            if (resolvedCasPath) {
                const casBlob = await CasStorageService.readCasBlob(resolvedCasPath);
                if (casBlob) imgBuffer = casBlob.buffer;
            }

            if (!imgBuffer) {
                const safeUrl = await assertSafeExternalUrl(currentUrl).catch(() => null);
                if (safeUrl) {
                    const fetched = await safeFetchExternal(safeUrl.toString(), {
                        maxBytes: 12 * 1024 * 1024,
                    }).catch(() => null);
                    if (fetched && fetched.ok) {
                        const ab = await fetched.arrayBuffer();
                        imgBuffer = Buffer.from(ab);
                    }
                }
            }

            if (!imgBuffer) {
                return res.status(422).json({ error: 'No se pudo obtener el binario de la imagen actual para re-encuadrar.' });
            }

            const storedOrigBytes = Number(data.foto_media_telemetry?.original_bytes || 0);
            const baseOriginalBytes = storedOrigBytes > 0 ? storedOrigBytes : imgBuffer.length;

            const framed = await OfficialEquipmentPhotoService.frameBufferToStudio4x3({
                inputBuffer: imgBuffer,
                originalByteLength: baseOriginalBytes,
            });

            const descriptor = await CasStorageService.persistDigestedBinary(
                {
                    buffer: framed.buffer,
                    sha256: framed.sha256,
                    mimeType: 'image/webp',
                    extension: 'webp',
                    profile: 'IMAGE_TECHNICAL_HD',
                    originalBytes: baseOriginalBytes,
                    optimizedBytes: framed.buffer.length,
                    savingsRatio: Number(
                        ((baseOriginalBytes - framed.buffer.length) / Math.max(1, baseOriginalBytes)).toFixed(4)
                    ),
                    width: framed.width,
                    height: framed.height,
                },
                {
                    scope: 'GLOBAL_OEM',
                    actorUid: req.opermaqContext?.actorId,
                    originalFilename: 'reframed_photo_studio88.webp',
                    clientOriginalBytes: baseOriginalBytes,
                }
            );

            const fotoMediaTelemetry = {
                original_bytes: baseOriginalBytes,
                optimized_bytes: framed.buffer.length,
                savings_pct: Math.max(
                    0,
                    Math.round(((baseOriginalBytes - framed.buffer.length) / Math.max(1, baseOriginalBytes)) * 100)
                ),
                sha256: framed.sha256,
                updated_at: new Date().toISOString(),
            };

            await docRef.update({
                foto_url: descriptor.downloadUrl,
                foto_media_telemetry: fotoMediaTelemetry,
                updatedAt: Date.now(),
            });

            void AuditLedger.record({
                tenantId: 'GLOBAL_OEM',
                actorUid: req.opermaqContext?.actorId || 'system',
                actorEmail: req.opermaqContext?.actorEmail || 'curador@minreport.com',
                module: 'opermaq',
                action: 'VAULT_ASSET_IMAGE_REFRAMED_STUDIO_88',
                targetEntity: `global_asset_catalog/${globalAssetId}`,
                details: {
                    globalAssetId,
                    sha256: framed.sha256,
                    telemetry: fotoMediaTelemetry,
                },
            }).catch(() => undefined);

            return res.status(200).json({
                success: true,
                foto_url: descriptor.downloadUrl,
                foto_media_telemetry: fotoMediaTelemetry,
            });
        } catch (err) {
            return handleVaultError(res, err, 'Error re-encuadrando fotografía oficial.');
        }
    }
);

vaultRouter.post(
    '/reconcile-sidebar-profile',
    requireCurateAI,
    checkVaultNotSealed,
    async (req: ScopedRequest, res: Response) => {
        const { globalAssetId } = req.body || {};
        if (!globalAssetId || typeof globalAssetId !== 'string') {
            return res.status(400).json({ error: 'globalAssetId es requerido.' });
        }

        try {
            const reconciled = await reconcileAssetSidebarProfileFromVault(globalAssetId, {
                allowGroundedEnrichmentIfNeeded: true,
            });
            if (!reconciled) {
                return res.status(404).json({ error: 'No se encontró el activo para reconciliar su perfil lateral.' });
            }

            void AuditLedger.record({
                tenantId: 'GLOBAL_OEM',
                actorUid: req.opermaqContext?.actorId || 'system',
                actorEmail: req.opermaqContext?.actorEmail || 'curador@minreport.com',
                module: 'opermaq',
                action: 'VAULT_SIDEBAR_PROFILE_RECONCILED',
                targetEntity: `global_asset_catalog/${globalAssetId}`,
                details: {
                    globalAssetId,
                    caracteristicasCount: reconciled.caracteristicas_principales.length,
                    ambienteCount: reconciled.ambiente_operativo.length,
                    contextoCount: reconciled.contexto_operativo.length,
                },
            }).catch(() => undefined);

            return res.status(200).json({
                success: true,
                ...reconciled,
            });
        } catch (err) {
            return handleVaultError(res, err, 'Error reconciliando perfil lateral del equipo.');
        }
    }
);

vaultRouter.post(
    '/update-sidebar-profile',
    requireCurateAI,
    checkVaultNotSealed,
    async (req: ScopedRequest, res: Response) => {
        const schema = z.object({
            globalAssetId: z.string().min(1),
            confirmationKeyword: z.string().min(1),
            caracteristicas_principales: z.array(z.string()).optional(),
            ambiente_operativo: z.array(z.string()).optional(),
            contexto_operativo: z.array(z.string()).optional(),
        });

        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Parámetros inválidos para actualización quirúrgica del perfil lateral.' });
        }

        const {
            globalAssetId,
            confirmationKeyword,
            caracteristicas_principales,
            ambiente_operativo,
            contexto_operativo,
        } = parsed.data;

        if (confirmationKeyword.trim().toUpperCase() !== 'ACTUALIZAR') {
            return res.status(400).json({
                error: 'Confirmación HITL inválida. Debe escribir exactamente ACTUALIZAR.',
            });
        }

        try {
            const docRef = db.collection('global_asset_catalog').doc(globalAssetId);
            const snap = await docRef.get();
            if (!snap.exists) {
                return res.status(404).json({ error: 'Activo no encontrado.' });
            }

            const updates: Record<string, any> = { updatedAt: Date.now() };
            if (Array.isArray(caracteristicas_principales)) {
                updates.caracteristicas_principales = caracteristicas_principales
                    .map((s) => s.trim())
                    .filter(Boolean);
                updates.sidebar_caracteristicas_human_curated = true;
            }
            if (Array.isArray(ambiente_operativo)) {
                updates.ambiente_operativo = ambiente_operativo
                    .map((s) => s.trim())
                    .filter(Boolean);
                updates.sidebar_ambiente_human_curated = true;
            }
            if (Array.isArray(contexto_operativo)) {
                updates.contexto_operativo = contexto_operativo
                    .map((s) => s.trim())
                    .filter(Boolean);
                updates.sidebar_contexto_human_curated = true;
            }

            await docRef.update(updates);

            void AuditLedger.record({
                tenantId: 'GLOBAL_OEM',
                actorUid: req.opermaqContext?.actorId || 'system',
                actorEmail: req.opermaqContext?.actorEmail || 'curador@minreport.com',
                module: 'opermaq',
                action: 'VAULT_SIDEBAR_PROFILE_HITL_UPDATED',
                targetEntity: `global_asset_catalog/${globalAssetId}`,
                details: {
                    globalAssetId,
                    updatedFields: Object.keys(updates).filter((k) => k !== 'updatedAt'),
                },
            }).catch(() => undefined);

            return res.status(200).json({
                success: true,
                ...updates,
            });
        } catch (err) {
            return handleVaultError(res, err, 'Error guardando actualización HITL del perfil lateral.');
        }
    }
);

vaultRouter.post(
    '/suggest-complementary-items',
    requireCurateAI,
    checkVaultNotSealed,
    async (req: ScopedRequest, res: Response) => {
        const { globalAssetId, pillarId } = req.body || {};
        if (!globalAssetId || !VALID_PILLAR_IDS.includes(pillarId)) {
            return res.status(400).json({ error: 'globalAssetId y pillarId válido son requeridos.' });
        }

        try {
            const suggestions = await suggestComplementaryPillarItems(globalAssetId, pillarId as PillarId);
            return res.status(200).json({ success: true, suggestions });
        } catch (err) {
            return handleVaultError(res, err, 'Error sugiriendo ítems complementarios.');
        }
    }
);

// ── ETAPA 3: CAZA PROFUNDA POR ÍTEM (SINCRÓNICA Y ASÍNCRONA) ─────────────────

vaultRouter.post('/hunt-item', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const schema = z.object({
        globalAssetId: z.string().min(1),
        pillarId: z.enum([
            'ficha_tecnica',
            'manual_operaciones',
            'pauta_mantencion',
            'matriz_riesgos',
            'checklist_pre_op',
        ]),
        itemId: z.string().min(1),
        intent: z.enum(['INITIAL_CAPTURE', 'INCREMENTAL_UPDATE']).optional(),
        humanCorrection: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Parámetros inválidos (globalAssetId, pillarId, itemId).' });
    }

    const { globalAssetId, pillarId, itemId, intent, humanCorrection } = parsed.data;

    try {
        const result = await huntVaultItem({
            globalAssetId,
            pillarId,
            itemId,
            intent,
            humanCorrection,
        });

        if (!result.success) {
            return res.status(500).json({ error: result.error || 'Fallo en caza técnica del ítem.' });
        }

        return res.status(200).json({
            success: true,
            content: result.content,
            item_sources: result.item_sources,
            hunted_at: result.hunted_at,
            mode: result.mode,
            newConflictsCount: result.newConflictsCount,
            addedNewCount: result.addedNewCount,
            addedConflictCount: result.addedConflictCount,
        });
    } catch (err) {
        return handleVaultError(res, err, 'Error ejecutando caza técnica por ítem.');
    }
});

vaultRouter.post('/hunt-item-async', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const schema = z.object({
        globalAssetId: z.string().min(1),
        pillarId: z.enum([
            'ficha_tecnica',
            'manual_operaciones',
            'pauta_mantencion',
            'matriz_riesgos',
            'checklist_pre_op',
        ]),
        itemId: z.string().min(1),
        intent: z.enum(['INITIAL_CAPTURE', 'INCREMENTAL_UPDATE']).optional(),
        humanCorrection: z.string().optional(),
        forceRestart: z.boolean().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Parámetros requeridos: globalAssetId, pillarId, itemId.' });
    }

    const { globalAssetId, pillarId, itemId, intent, humanCorrection, forceRestart } = parsed.data;
    const taskId = buildHuntTaskId(globalAssetId, pillarId, itemId);

    try {
        const taskDoc = await db.collection('task_status').doc(taskId).get();
        if (taskDoc.exists && !forceRestart) {
            const current = taskDoc.data();
            if (isHuntTaskActivelyRunning(taskId, current)) {
                return res.status(200).json({
                    success: true,
                    taskId,
                    alreadyRunning: true,
                    message: 'Investigación en curso.',
                });
            }
        }

        // Marcar ítem en GENERANDO y sellar `initial_hunt_activated_at` desde su primera activación mediante transacción atómica
        const docRef = db.collection('global_asset_catalog').doc(globalAssetId);
        const pillarRef = docRef.collection('pillars').doc(pillarId);
        const nowIso = new Date().toISOString();
        const lockedTitle = await db.runTransaction(async (tx) => {
            const [snap, pillarSnap] = await Promise.all([tx.get(docRef), tx.get(pillarRef)]);
            if (!snap.exists) return null;
            const rawPillar = pillarSnap.exists
                ? pillarSnap.data()
                : snap.data()?.knowledge_vault?.[pillarId];
            if (!rawPillar) return null;
            const items = [...(rawPillar.items || [])];
            const idx = items.findIndex((it: any) => it.item_id === itemId);
            if (idx === -1) return null;
            if (items[idx].is_human_locked === true) {
                return String(items[idx].title || itemId);
            }
            items[idx] = {
                ...items[idx],
                initial_hunt_activated_at: items[idx].initial_hunt_activated_at || nowIso,
                content_status: 'GENERANDO',
                hunt_error: null,
            };
            VaultPersistenceService.writePillarInTransaction(tx, {
                globalAssetId,
                pillarId: pillarId as PillarId,
                pillarDoc: {
                    ...(rawPillar as any),
                    pillar_id: pillarId as PillarId,
                    items,
                    updated_at: nowIso,
                },
            });
            return null;
        });

        if (lockedTitle) {
            return res.status(403).json({
                error: `El ítem "${lockedTitle}" está bloqueado por autoridad humana.`,
            });
        }

        const enqueued = await enqueueItemHuntTask({
            globalAssetId,
            pillarId: pillarId as PillarId,
            itemId,
            intent,
            tenantId: ctx.tenantId,
            actorId: ctx.actorId,
            humanCorrection,
            forceRestart: Boolean(forceRestart),
        });

        return res.status(202).json({
            success: true,
            taskId: enqueued.taskId,
            mode: enqueued.dispatchMode,
            message: 'Tarea de caza encolada.',
        });
    } catch (err) {
        return handleVaultError(res, err, 'Error encolando caza asíncrona.');
    }
});

vaultRouter.get('/hunt-status/:taskId', async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const taskId = String(req.params.taskId);
    const docRef = db.collection('task_status').doc(taskId);

    try {
        const initialSnap = await docRef.get();
        if (initialSnap.exists) {
            const task = initialSnap.data() || {};
            if (task.tenantId !== ctx.tenantId && !ctx.capabilities.canCurateAI) {
                return res.status(403).json({
                    error: 'TENANT_ACCESS_DENIED',
                    message: 'No autorizado para suscribirse a una tarea de otro tenant.',
                });
            }
        }
    } catch (err) {
        return handleVaultError(res, err, 'Error verificando permisos de tarea.');
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const unsubscribe = docRef.onSnapshot(
        (docSnap) => {
            if (docSnap.exists) {
                const data = docSnap.data();
                if (data?.tenantId !== ctx.tenantId && !ctx.capabilities.canCurateAI) {
                    res.write(`data: ${JSON.stringify({ status: 'FORBIDDEN', error: 'TENANT_ACCESS_DENIED' })}\n\n`);
                    unsubscribe();
                    res.end();
                    return;
                }
                res.write(`data: ${JSON.stringify(data)}\n\n`);
                if (data?.status === 'COMPLETED' || data?.status === 'FAILED') {
                    unsubscribe();
                    res.end();
                }
            } else {
                res.write(`data: ${JSON.stringify({ status: 'NOT_FOUND' })}\n\n`);
                unsubscribe();
                res.end();
            }
        },
        (err) => {
            res.write(`data: ${JSON.stringify({ status: 'ERROR', message: err.message })}\n\n`);
            unsubscribe();
            res.end();
        }
    );

    req.on('close', () => unsubscribe());
});

// ── ETAPA 4: ASISTENCIA IA, CHAT CONVERSACIONAL Y CURADURÍA HITL ─────────────

vaultRouter.post('/ai-assist-item', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const { globalAssetId, pillarId, itemId, userRequest } = req.body || {};
    if (!globalAssetId || !pillarId || !itemId || !userRequest) {
        return res.status(400).json({
            error: 'Parámetros requeridos: globalAssetId, pillarId, itemId, userRequest.',
        });
    }

    try {
        const result = await assistItemEdit({ globalAssetId, pillarId, itemId, userRequest });
        if (!result.success) {
            return res.status(500).json({ error: result.error || 'Error en edición asistida.' });
        }
        return res.status(200).json(result);
    } catch (err) {
        return handleVaultError(res, err, 'Error en asistente de edición IA.');
    }
});

vaultRouter.post('/ai-assist-chat', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const { globalAssetId, pillarId, itemId, sessionId, userRequest, selectedFragment } = req.body || {};

    if (!globalAssetId || !pillarId || !itemId || !sessionId || !userRequest) {
        return res.status(400).json({
            error: 'Parámetros requeridos: globalAssetId, pillarId, itemId, sessionId, userRequest.',
        });
    }

    try {
        const sessionRef = db
            .collection('global_asset_catalog')
            .doc(globalAssetId)
            .collection('vault_chats')
            .doc(itemId)
            .collection('sessions')
            .doc(sessionId);

        const sessionSnap = await sessionRef.get();
        const history: ChatMessage[] = sessionSnap.exists ? sessionSnap.data()?.messages || [] : [];

        const result = await processVaultChat({
            globalAssetId,
            pillarId,
            itemId,
            userRequest,
            history,
            selectedFragment,
            userEmail: ctx.actorEmail,
        });

        if (!result.success) {
            return res.status(500).json({ error: result.error || 'Error procesando chat técnico.' });
        }

        const userMsg: ChatMessage = {
            id: `msg_user_${Date.now()}`,
            role: 'user',
            content: userRequest,
            timestamp: new Date().toISOString(),
        };

        const modelMsg: ChatMessage = {
            id: `msg_model_${Date.now()}`,
            role: 'model',
            content: result.message,
            timestamp: new Date().toISOString(),
            ...(result.highlightText !== undefined ? { highlightText: result.highlightText } : {}),
            ...(result.draftContent !== undefined
                ? {
                      draftContent: result.draftContent,
                      draftStatus: 'PENDING' as const,
                  }
                : {}),
            ...(result.selectedFragmentTarget !== undefined
                ? { selectedFragmentTarget: result.selectedFragmentTarget }
                : {}),
            ...(result.intent !== undefined ? { intent: result.intent } : {}),
        };

        const nextHistory = [...history, userMsg, modelMsg];
        await sessionRef.set(
            {
                sessionId,
                itemId,
                pillarId,
                createdAt: sessionSnap.exists ? sessionSnap.data()?.createdAt : new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                messages: nextHistory,
            },
            { merge: true }
        );

        return res.status(200).json(result);
    } catch (err) {
        return handleVaultError(res, err, 'Error en chat técnico de bóveda.');
    }
});

vaultRouter.post('/ai-assist-session-close', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const { globalAssetId, itemId, sessionId } = req.body || {};
    if (!globalAssetId || !itemId || !sessionId) {
        return res.status(400).json({ error: 'Parámetros requeridos: globalAssetId, itemId, sessionId.' });
    }

    try {
        await db
            .collection('global_asset_catalog')
            .doc(globalAssetId)
            .collection('vault_chats')
            .doc(itemId)
            .collection('sessions')
            .doc(sessionId)
            .set({ closedAt: new Date().toISOString() }, { merge: true });

        return res.status(200).json({ success: true });
    } catch (err) {
        return handleVaultError(res, err, 'Error cerrando sesión de chat.');
    }
});

vaultRouter.get('/ai-assist-chat/history', async (req: ScopedRequest, res: Response) => {
    const { globalAssetId, itemId, sessionId } = req.query;
    if (!globalAssetId || !itemId) {
        return res.status(400).json({ error: 'Parámetros requeridos: globalAssetId, itemId.' });
    }

    try {
        const sessionsColl = db
            .collection('global_asset_catalog')
            .doc(String(globalAssetId))
            .collection('vault_chats')
            .doc(String(itemId))
            .collection('sessions');

        if (sessionId) {
            const snap = await sessionsColl.doc(String(sessionId)).get();
            if (!snap.exists) return res.status(404).json({ error: 'Sesión no encontrada.' });
            return res.status(200).json(snap.data());
        }

        const snap = await sessionsColl.limit(10).get();
        const sessions = snap.docs
            .map((d) => d.data())
            .sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
            .slice(0, 5);
        return res.status(200).json({ sessions });
    } catch (err) {
        return handleVaultError(res, err, 'Error consultando historial de chat.');
    }
});

vaultRouter.post('/ai-assist-rejection', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const { globalAssetId, pillarId, itemId, rejectionNote } = req.body || {};
    if (!globalAssetId || !pillarId || !itemId || !rejectionNote) {
        return res.status(400).json({
            error: 'Parámetros requeridos: globalAssetId, pillarId, itemId, rejectionNote.',
        });
    }

    try {
        const result = await assistRejection({ globalAssetId, pillarId, itemId, rejectionNote });
        if (!result.success) {
            return res.status(500).json({ error: result.error || 'Error asistiendo corrección.' });
        }
        return res.status(200).json(result);
    } catch (err) {
        return handleVaultError(res, err, 'Error en asistente de rechazo HITL.');
    }
});

vaultRouter.post('/apply-assist-proposal', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const { globalAssetId, pillarId, itemId, finalContent, intent, sessionId, messageId } = req.body || {};

    if (!globalAssetId || !pillarId || !itemId || !finalContent) {
        return res.status(400).json({ error: 'Parámetros requeridos: globalAssetId, pillarId, itemId, finalContent.' });
    }

    try {
        const docRef = db.collection('global_asset_catalog').doc(globalAssetId);
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
            globalAssetId,
            (req as any).catalogDocSnap
        );
        if (!hydrated.exists || !hydrated.data) {
            return res.status(404).json({ error: 'Catálogo no encontrado.' });
        }

        const catalogData = hydrated.data;
        const pillar = catalogData?.knowledge_vault?.[pillarId];
        if (!pillar) return res.status(404).json({ error: 'Pilar no encontrado.' });

        const items = [...(pillar.items || [])];
        const idx = items.findIndex((it: any) => it.item_id === itemId);
        if (idx === -1) return res.status(404).json({ error: 'Ítem no encontrado.' });
        if (items[idx].is_human_locked === true) {
            return res.status(403).json({ error: 'Ítem bloqueado por autoridad humana.' });
        }

        const sanitized = await sanitizeAndEnrichItemContentForSave(
            String(finalContent),
            pillarId as PillarId
        );
        const nowIso = new Date().toISOString();
        const oldContent = items[idx].content;

        const nextHistory = await VaultPersistenceService.appendItemRevision({
            globalAssetId,
            pillarId: pillarId as PillarId,
            itemId,
            existingHistory: items[idx].historial_cambios,
            accion: `EDICIÓN_ASISTIDA_${intent || 'GENERAL'}`,
            actor: ctx.actorEmail,
            detalle: 'Propuesta aplicada mediante corrector técnico.',
            snapshotAnterior: oldContent,
        });

        items[idx] = {
            ...items[idx],
            content: sanitized.content,
            symbology_refs: sanitized.symbologyRefs,
            content_status: 'COMPLETADO',
            hunted_at: nowIso,
            last_edit_by: ctx.actorEmail,
            historial_cambios: nextHistory,
        };

        const propagation = await propagateItemContentMutationEffects({
            globalAssetId,
            pillarId: pillarId as PillarId,
            itemId,
            updatedItem: items[idx],
            updatedItems: items,
            existingVault: catalogData.knowledge_vault,
        });

        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_ASSIST_PROPOSAL_APPLIED',
            targetEntity: `global_asset_catalog/${globalAssetId}/pillars/${pillarId}/${itemId}`,
            details: { pillarId, itemId, intent: intent || 'GENERAL' },
        }).catch(() => undefined);

        if (sessionId) {
            const sessionRef = docRef.collection('vault_chats').doc(itemId).collection('sessions').doc(sessionId);
            const sessionSnap = await sessionRef.get();
            if (sessionSnap.exists) {
                const rawHistory: ChatMessage[] = sessionSnap.data()?.messages || [];
                const history = rawHistory.map((m) => {
                    if (m.role === 'model' && m.draftContent && (!messageId || m.id === messageId || m.draftStatus !== 'DISCARDED')) {
                        return {
                            ...m,
                            draftStatus: 'APPLIED' as const,
                            appliedAt: nowIso,
                        };
                    }
                    return m;
                });
                history.push(
                    {
                        id: `msg_user_aprobacion_${Date.now()}`,
                        role: 'user',
                        content: HITL_CONFIRM_KEYWORD,
                        timestamp: nowIso,
                    },
                    {
                        id: `msg_model_aprobacion_${Date.now()}`,
                        role: 'model',
                        content: 'Cambios consolidados en el catálogo, sincronizados en la cadena de pilares y registrados en el historial del ítem.',
                        timestamp: nowIso,
                        intent: 'CHAT',
                    }
                );
                await sessionRef.set({ messages: history, updatedAt: nowIso }, { merge: true });
            }
        }

        return res.status(200).json({
            success: true,
            content: sanitized.content,
            symbology_refs: sanitized.symbologyRefs,
            content_digest_sha256: propagation.contentDigestSha256,
            vault_merkle_root_sha256: propagation.vaultMerkleRootSha256,
        });
    } catch (err) {
        return handleVaultError(res, err, 'Error aplicando propuesta asistida.');
    }
});

vaultRouter.post('/dismiss-assist-proposal', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const { globalAssetId, itemId, sessionId, messageId } = req.body || {};
    if (!globalAssetId || !itemId || !sessionId) {
        return res.status(400).json({ error: 'Parámetros requeridos: globalAssetId, itemId, sessionId.' });
    }

    try {
        const sessionRef = db
            .collection('global_asset_catalog')
            .doc(String(globalAssetId))
            .collection('vault_chats')
            .doc(String(itemId))
            .collection('sessions')
            .doc(String(sessionId));

        const sessionSnap = await sessionRef.get();
        if (!sessionSnap.exists) {
            return res.status(200).json({ success: true });
        }

        const nowIso = new Date().toISOString();
        const rawHistory: ChatMessage[] = sessionSnap.data()?.messages || [];
        const updatedHistory = rawHistory.map((m) => {
            if (m.role === 'model' && m.draftContent && (!messageId || m.id === messageId)) {
                return {
                    ...m,
                    draftStatus: 'DISCARDED' as const,
                    discardedAt: nowIso,
                };
            }
            return m;
        });

        await sessionRef.set({ messages: updatedHistory, updatedAt: nowIso }, { merge: true });
        return res.status(200).json({ success: true });
    } catch (err) {
        return handleVaultError(res, err, 'Error descartando propuesta de borrador.');
    }
});

// Resolución in-situ de una imagen técnica pendiente en la sección exacta del capítulo
// (Re-Auditoría v2 · F2: validación CAS en servidor, confirmación "ACTUALIZAR", anclaje determinista y advisory si está bloqueado)
const PENDING_FIGURE_TYPES = [
    'DIAGRAMA_ACOTADO',
    'CURVA_RENDIMIENTO',
    'ESQUEMA_HIDRAULICO_ELECTRICO',
    'FOTO_COMPONENTE',
    'MAPA_LUBRICACION_PM',
    'SIMBOLOGIA_SEGURIDAD',
    'PLANO_VECTORIAL_SVG',
] as const;

const ResolvePendingFigureSchema = z.object({
    globalAssetId: z.string().min(1),
    pillarId: z.enum(['ficha_tecnica', 'manual_operaciones', 'pauta_mantencion', 'matriz_riesgos', 'checklist_pre_op']),
    itemId: z.string().min(1),
    confirmWord: z.string().refine((w) => w.trim().toUpperCase() === HITL_CONFIRM_KEYWORD, {
        message: `Debe confirmar escribiendo "${HITL_CONFIRM_KEYWORD}".`,
    }),
    pendingMarkerLine: z.string().max(1200).optional(),
    pendingDescription: z.string().max(600).optional(),
    figure: z.object({
        sha256: z.string().regex(/^[a-f0-9]{64}$/i),
        storage_url: z
            .string()
            .min(1)
            .refine((u) => !/^(?:blob:|data:|javascript:)/i.test(u.trim()), {
                message: 'URL no CAS rechazada (blob:/data: no se persisten).',
            }),
        figure_type: z.enum(PENDING_FIGURE_TYPES),
        title_es: z.string().min(1).max(400),
        caption_es: z.string().max(400).optional(),
        source_url: z.string().max(2000).optional(),
    }),
});

vaultRouter.post(
    '/resolve-pending-figure',
    requireCurateAI,
    checkVaultNotSealed,
    async (req: ScopedRequest, res: Response) => {
        const ctx = req.opermaqContext!;
        const parsed = ResolvePendingFigureSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: parsed.error.issues[0]?.message || 'Parámetros inválidos para resolución de figura pendiente.',
                details: parsed.error.issues,
            });
        }

        const { globalAssetId, pillarId, itemId, pendingMarkerLine, pendingDescription, figure } = parsed.data;

        // OPT-F2.1: el binario debe existir en el registro CAS y la URL debe ser exactamente la del registro
        const casDescriptor = await CasStorageService.preflightCheck(figure.sha256, 'GLOBAL_OEM').catch(() => null);
        if (!casDescriptor) {
            return res.status(422).json({ error: 'El SHA-256 informado no existe en el registro CAS (GLOBAL_OEM).' });
        }
        const expectedGateway = CasStorageService.buildGatewayUrl('GLOBAL_OEM', casDescriptor.sha256, casDescriptor.extension);
        const clientUrl = figure.storage_url.trim();
        if (clientUrl !== casDescriptor.downloadUrl && clientUrl !== expectedGateway) {
            return res.status(422).json({ error: 'La URL de la figura no coincide con el registro CAS.' });
        }

        const cleanTitle = sanitizeMarkdownLabel(
            ConfidentialityAirlockService.scrubDeterministicPii(figure.title_es).scrubbed,
            160
        );
        const cleanCaption = figure.caption_es
            ? sanitizeMarkdownLabel(ConfidentialityAirlockService.scrubDeterministicPii(figure.caption_es).scrubbed, 220)
            : '';
        const safeSourceUrl =
            figure.source_url && /^https:\/\//i.test(figure.source_url.trim()) ? figure.source_url.trim() : undefined;
        const mime: ExtractedFigureRef['mime_type'] =
            casDescriptor.mimeType === 'image/svg+xml'
                ? 'image/svg+xml'
                : casDescriptor.mimeType === 'image/png'
                ? 'image/png'
                : 'image/webp';

        const newFigureRef: ExtractedFigureRef = {
            figure_id: `fig_manual_${casDescriptor.sha256.slice(0, 12)}`,
            sha256: casDescriptor.sha256,
            ...(casDescriptor.phashHex ? { phash_hex: casDescriptor.phashHex } : {}),
            storage_url: casDescriptor.downloadUrl,
            mime_type: mime,
            figure_type: figure.figure_type,
            title_es: cleanTitle,
            ...(cleanCaption ? { caption_es: cleanCaption } : {}),
            ...(safeSourceUrl ? { source_url: safeSourceUrl } : {}),
            ...(casDescriptor.width ? { width: casDescriptor.width } : {}),
            ...(casDescriptor.height ? { height: casDescriptor.height } : {}),
            original_bytes: casDescriptor.originalBytes,
            optimized_bytes: casDescriptor.optimizedBytes,
            savings_pct: casDescriptor.savingsPct ?? Number((Number(casDescriptor.savingsRatio || 0) * 100).toFixed(1)),
        };
        const figureBlock = formatFigureMarkdownBlock(newFigureRef);

        try {
            const docRef = db.collection('global_asset_catalog').doc(globalAssetId);
            const pillarRef = docRef.collection('pillars').doc(pillarId);
            const outcome = await db.runTransaction(async (tx) => {
                const [snap, pillarSnap] = await Promise.all([tx.get(docRef), tx.get(pillarRef)]);
                if (!snap.exists) {
                    const err: any = new Error('Catálogo no encontrado.');
                    err.statusCode = 404;
                    throw err;
                }
                const pillar = pillarSnap.exists
                    ? pillarSnap.data()
                    : snap.data()?.knowledge_vault?.[pillarId];
                if (!pillar || !Array.isArray(pillar.items)) {
                    const err: any = new Error('Pilar no encontrado.');
                    err.statusCode = 404;
                    throw err;
                }
                const items = [...pillar.items];
                const idx = items.findIndex((it: any) => it.item_id === itemId);
                if (idx === -1) {
                    const err: any = new Error('Ítem no encontrado.');
                    err.statusCode = 404;
                    throw err;
                }
                const nowIso = new Date().toISOString();

                // OPT-F2.5: ítem aprobado/bloqueado → la figura queda como propuesta (advisory) sin tocar el contenido
                if (items[idx].is_human_locked === true) {
                    const advisories = [...(items[idx].locked_item_advisories || [])];
                    if (!advisories.some((a: any) => a?.figure?.sha256 === newFigureRef.sha256)) {
                        advisories.push({
                            advisory_id: `adv_fig_${Date.now()}`,
                            kind: 'PENDING_FIGURE',
                            detected_at: nowIso,
                            source_label: `Imagen técnica aportada por ${ctx.actorEmail}`,
                            ...(safeSourceUrl ? { source_url: safeSourceUrl } : {}),
                            summary: `Imagen propuesta para sección pendiente: "${cleanTitle}". Requiere desbloqueo del ítem para integrarla.`,
                            proposed_value: figureBlock,
                            figure: newFigureRef,
                            ...(pendingMarkerLine ? { pending_marker_line: pendingMarkerLine.slice(0, 1200) } : {}),
                            acknowledged: false,
                        });
                        items[idx] = { ...items[idx], locked_item_advisories: advisories };
                        VaultPersistenceService.writePillarInTransaction(tx, {
                            globalAssetId,
                            pillarId: pillarId as PillarId,
                            pillarDoc: {
                                ...(pillar as any),
                                pillar_id: pillarId as PillarId,
                                items,
                                updated_at: nowIso,
                            },
                        });
                    }
                    return { mode: 'LOCKED_ADVISORY' as const };
                }

                const currentContent = String(items[idx].content || '');
                const sanitizedCurrent = sanitizeMarkdownFiguresAndBrokenMarkers(
                    currentContent,
                    items[idx].title || '',
                    items[idx].item_sources || [],
                    items[idx].figures || []
                );
                const existingFigCount = (
                    sanitizedCurrent.match(/!\[(?!IMAGEN[_\s-]PENDIENTE)[^\]]*\]\([^)]+\)/gi) || []
                ).length;
                const nextFigNum = existingFigCount + 1;
                const numberedFigureBlock = formatFigureMarkdownBlock(newFigureRef, nextFigNum);

                const replaceMarkerInSections = (markdownInput: string, targetLine: string): string | null => {
                    if (!targetLine || !markdownInput.includes(targetLine)) return null;
                    const sections = splitMarkdownSections(markdownInput);
                    let replaced = false;
                    const outSections = sections.map((sec) => {
                        const lineIdx = sec.lines.findIndex((l) => l.trim() === targetLine.trim() || l.includes(targetLine));
                        if (lineIdx === -1 || replaced) return sec.lines.join('\n');
                        replaced = true;
                        const beforeMarker = sec.lines.slice(0, lineIdx);
                        const afterMarker = sec.lines.slice(lineIdx + 1);
                        const citedBefore = injectExplicitFigureCitationInSection(beforeMarker, nextFigNum, cleanTitle);
                        return [...citedBefore, '', numberedFigureBlock, '', ...afterMarker].join('\n');
                    });
                    return replaced ? outSections.join('\n').replace(/\n{4,}/g, '\n\n\n') : null;
                };

                let nextContent: string | null = null;

                // 1. Marcador persistido exacto (sobre contenido original o sanitizado)
                if (pendingMarkerLine) {
                    nextContent =
                        replaceMarkerInSections(sanitizedCurrent, pendingMarkerLine) ??
                        replaceMarkerInSections(currentContent, pendingMarkerLine);
                }

                // 2. OPT-F2.6: marcadores deterministas o reparados en servidor sobre el texto guardado
                //    y elección del más afín a la descripción enviada por el cliente
                if (nextContent === null) {
                    const normalized = reconcileSectionFiguresAndPendingMarkers(
                        sanitizedCurrent,
                        [],
                        items[idx].item_sources || [],
                        items[idx].title || ''
                    );
                    const markerLines = normalized
                        .split('\n')
                        .filter((l) => parsePendingMarker(l) !== null);
                    const reference = `${pendingDescription || ''} ${pendingMarkerLine || ''}`;
                    let bestLine: string | null = null;
                    let bestScore = 0;
                    for (const ml of markerLines) {
                        const desc = parsePendingMarker(ml)?.description || '';
                        const score = markerLines.length === 1 ? 1 : tokenContainment(desc, reference);
                        if (score > bestScore) {
                            bestScore = score;
                            bestLine = ml;
                        }
                    }
                    if (bestLine && bestScore >= 0.35) {
                        nextContent = replaceMarkerInSections(normalized, bestLine);
                    }
                }

                if (nextContent === null) {
                    const err: any = new Error(
                        'No se localizó la sección de la imagen pendiente en el contenido guardado. Recargue el ítem e intente nuevamente.'
                    );
                    err.statusCode = 409;
                    throw err;
                }

                const { merged: mergedFigures } = mergeDeduplicatedFigures(items[idx].figures || [], [newFigureRef]);
                const referencedFigures = filterFiguresReferencedInMarkdown(nextContent, mergedFigures);

                let revisionId: string | undefined;
                if (currentContent.length > 0) {
                    revisionId = `rev_${Date.now()}_${randomUUID().slice(0, 8)}`;
                    const detalleHist = `Imagen técnica integrada en sección: "${cleanTitle}" (SHA-256 ${newFigureRef.sha256.slice(
                        0,
                        12
                    )}, ${newFigureRef.original_bytes || 0} B ➔ ${newFigureRef.optimized_bytes || 0} B, -${
                        newFigureRef.savings_pct || 0
                    }%).`;
                    tx.set(docRef.collection('item_revisions').doc(revisionId), {
                        revision_id: revisionId,
                        global_asset_id: globalAssetId,
                        pillar_id: pillarId,
                        item_id: itemId,
                        accion: 'RESOLUCION_IMAGEN_PENDIENTE_CAS',
                        actor: ctx.actorEmail,
                        detalle: detalleHist,
                        snapshot_anterior: currentContent,
                        created_at: nowIso,
                    });
                }

                const cleanExistingHistory = (items[idx].historial_cambios || []).map((h: any) => {
                    const { snapshot_anterior: _drop, ...rest } = h || {};
                    return rest;
                });

                items[idx] = {
                    ...items[idx],
                    content: nextContent,
                    figures: referencedFigures,
                    last_edit_by: ctx.actorEmail,
                    historial_cambios: [
                        ...cleanExistingHistory,
                        {
                            fecha: nowIso,
                            accion: 'RESOLUCION_IMAGEN_PENDIENTE_CAS',
                            actor: ctx.actorEmail,
                            detalle: `Imagen técnica integrada en sección: "${cleanTitle}" (SHA-256 ${newFigureRef.sha256.slice(
                                0,
                                12
                            )}, ${newFigureRef.original_bytes || 0} B ➔ ${newFigureRef.optimized_bytes || 0} B, -${
                                newFigureRef.savings_pct || 0
                            }%).`,
                            ...(revisionId ? { revision_id: revisionId } : {}),
                        },
                    ].slice(-20),
                };

                const contentDigest = computePillarContentDigestSha256(items);
                VaultPersistenceService.writePillarInTransaction(tx, {
                    globalAssetId,
                    pillarId: pillarId as PillarId,
                    pillarDoc: {
                        ...(pillar as any),
                        pillar_id: pillarId as PillarId,
                        items,
                        content_digest_sha256: contentDigest,
                        updated_at: nowIso,
                    },
                });
                return { mode: 'INTEGRATED' as const };
            });

            await AuditLedger.record({
                module: 'opermaq',
                tenantId: ctx.tenantId,
                actorUid: ctx.actorId,
                actorEmail: ctx.actorEmail,
                action:
                    outcome.mode === 'LOCKED_ADVISORY'
                        ? 'VAULT_PENDING_FIGURE_PROPOSED_LOCKED'
                        : 'VAULT_PENDING_FIGURE_RESOLVED_CAS',
                targetEntity: `global_asset_catalog/${globalAssetId}/knowledge_vault/${pillarId}/${itemId}`,
                details: {
                    sha256: newFigureRef.sha256,
                    figure_type: newFigureRef.figure_type,
                    title_es: cleanTitle,
                    original_bytes: newFigureRef.original_bytes,
                    optimized_bytes: newFigureRef.optimized_bytes,
                    savings_pct: newFigureRef.savings_pct,
                },
            }).catch(() => undefined);

            return res.status(200).json({ success: true, mode: outcome.mode, figure: newFigureRef });
        } catch (err) {
            return handleVaultError(res, err, 'Error integrando imagen técnica en la sección del capítulo.');
        }
    }
);

vaultRouter.post('/correct-manual-item', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const { title, rationale, globalAssetId, pillarId } = req.body || {};
    if (!title || !rationale) {
        return res.status(400).json({ error: 'title y rationale son requeridos.' });
    }

    try {
        let makeModel: string | undefined;
        let tipoEquipo: string | undefined;
        if (globalAssetId) {
            const snap = await db.collection('global_asset_catalog').doc(String(globalAssetId)).get();
            if (snap.exists) {
                const d = snap.data() || {};
                makeModel = d.make_model || `${d.make_oficial || d.make || ''} ${d.model_oficial || d.model || ''}`.trim();
                tipoEquipo = d.tipo_equipo;
            }
        }
        const corrected = await correctManualItemText(String(title), String(rationale), {
            makeModel,
            tipoEquipo,
            pillarId: VALID_PILLAR_IDS.includes(pillarId) ? (pillarId as PillarId) : undefined,
        });
        return res.status(200).json({ corrected });
    } catch {
        return res.status(200).json({
            corrected: {
                title: String(title),
                rationale: String(rationale),
                section: 'ESPECIFICACIÓN TÉCNICA',
            },
        });
    }
});

vaultRouter.post('/create-item', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const { globalAssetId, pillarId, title, section, rationale, priority, itemSource, confirmWord } = req.body || {};

    if (!globalAssetId || !pillarId || !title || !section) {
        return res.status(400).json({
            error: 'Parámetros requeridos: globalAssetId, pillarId, title, section.',
        });
    }
    if (confirmWord !== undefined && String(confirmWord).trim().toUpperCase() !== HITL_CONFIRM_KEYWORD) {
        return res.status(400).json({
            error: `Debe confirmar escribiendo "${HITL_CONFIRM_KEYWORD}".`,
        });
    }

    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
            globalAssetId,
            (req as any).catalogDocSnap
        );
        if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Catálogo no encontrado.' });

        const pillar = hydrated.data.knowledge_vault?.[pillarId];
        if (!pillar) return res.status(404).json({ error: 'Pilar no encontrado.' });

        // Sanitización determinista PII (Ley N° 21.719)
        const cleanTitle = ConfidentialityAirlockService.scrubDeterministicPii(String(title)).scrubbed.trim();
        const cleanSection = ConfidentialityAirlockService.scrubDeterministicPii(String(section)).scrubbed.trim().toUpperCase();
        const cleanRationale = rationale
            ? ConfidentialityAirlockService.scrubDeterministicPii(String(rationale)).scrubbed.trim()
            : 'Registrado manualmente.';

        const items = [...(pillar.items || [])];
        const newId = `manual_${randomUUID().substring(0, 8)}`;

        const newItem = {
            item_id: newId,
            title: cleanTitle,
            section: cleanSection || 'ESPECIFICACIÓN TÉCNICA',
            rationale: cleanRationale,
            priority: priority || 'IMPORTANTE',
            order: items.filter((it: any) => !it.is_discarded).length + 1,
            content_status: 'PENDIENTE',
            content: null,
            is_discarded: false,
            created_at: new Date().toISOString(),
            created_by: ctx.actorEmail,
            historial_cambios: [
                {
                    fecha: new Date().toISOString(),
                    accion: itemSource ? 'CREACION_IA_COMPLEMENTARIA' : 'CREACION_MANUAL',
                    actor: ctx.actorEmail,
                    detalle: `Ítem inscrito: "${cleanTitle}".`,
                },
            ],
            item_sources: [
                itemSource
                    ? {
                          type: itemSource.type,
                          author: itemSource.author,
                          description: itemSource.description,
                          url: itemSource.url,
                      }
                    : {
                          type: 'MANUAL',
                          author: ctx.actorEmail,
                          description: cleanRationale || cleanTitle,
                          url: '',
                      },
            ],
        };

        const finalItems = sortAndReindexPillarItems(pillarId as PillarId, [...items, newItem]);
        const newStructureDigest = computePillarStructureDigestSha256(finalItems);
        const pillarSources = [...(pillar.classified_sources_itemized || []), newItem.item_sources[0]];
        const updatedPending = (pillar.suggested_items_pending || []).filter(
            (it: any) => String(it.title || '').toLowerCase().trim() !== String(title).toLowerCase().trim()
        );

        const nextPillarDoc = {
            ...pillar,
            pillar_id: pillarId as PillarId,
            items: finalItems,
            structure_digest_sha256: newStructureDigest,
            classified_sources_itemized: pillarSources,
            suggested_items_pending: updatedPending,
            updated_at: new Date().toISOString(),
        };
        const nextVault = {
            ...(hydrated.data.knowledge_vault || {}),
            [pillarId]: nextPillarDoc,
        };
        const newMerkleRoot = computeVaultMerkleRootSha256(nextVault);

        await VaultPersistenceService.savePillarDocument({
            globalAssetId,
            pillarId: pillarId as PillarId,
            pillarDoc: nextPillarDoc,
            vaultMerkleRootSha256: newMerkleRoot,
        });

        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: itemSource ? 'VAULT_ITEM_CREATED_FROM_SUGGESTION' : 'VAULT_ITEM_CREATED_MANUAL',
            targetEntity: `global_asset_catalog/${globalAssetId}/knowledge_vault/${pillarId}/${newId}`,
            details: {
                pillarId,
                itemId: newId,
                title: cleanTitle,
                section: cleanSection,
                actorEmail: ctx.actorEmail,
            },
        }).catch(() => undefined);

        return res.status(200).json({ success: true, item: newItem });
    } catch (err) {
        return handleVaultError(res, err, 'Error creando ítem en pilar.');
    }
});

vaultRouter.post('/discard-item', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const { globalAssetId, pillarId, itemId, confirmWord } = req.body || {};

    if (!globalAssetId || !pillarId || !itemId) {
        return res.status(400).json({ error: 'Parámetros requeridos: globalAssetId, pillarId, itemId.' });
    }
    if (confirmWord !== undefined && String(confirmWord).trim().toUpperCase() !== HITL_CONFIRM_KEYWORD) {
        return res.status(400).json({ error: `Debe confirmar escribiendo "${HITL_CONFIRM_KEYWORD}".` });
    }

    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
            globalAssetId,
            (req as any).catalogDocSnap
        );
        if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Catálogo no encontrado.' });

        const pillar = hydrated.data.knowledge_vault?.[pillarId];
        if (!pillar) return res.status(404).json({ error: 'Pilar no encontrado.' });

        const items = [...(pillar.items || [])];
        const idx = items.findIndex((it: any) => it.item_id === itemId);
        if (idx === -1) return res.status(404).json({ error: 'Ítem no encontrado.' });

        items[idx] = {
            ...items[idx],
            is_discarded: true,
            discarded_at: new Date().toISOString(),
            discarded_by: ctx.actorEmail,
        };

        const finalItems = sortAndReindexPillarItems(pillarId as PillarId, items);
        const newStructureDigest = computePillarStructureDigestSha256(finalItems);
        const nextPillarDoc = {
            ...pillar,
            pillar_id: pillarId as PillarId,
            items: finalItems,
            structure_digest_sha256: newStructureDigest,
            updated_at: new Date().toISOString(),
        };
        const nextVault = {
            ...(hydrated.data.knowledge_vault || {}),
            [pillarId]: nextPillarDoc,
        };
        const newMerkleRoot = computeVaultMerkleRootSha256(nextVault);

        await VaultPersistenceService.savePillarDocument({
            globalAssetId,
            pillarId: pillarId as PillarId,
            pillarDoc: nextPillarDoc,
            vaultMerkleRootSha256: newMerkleRoot,
        });

        if (pillarId === 'ficha_tecnica' || pillarId === 'pauta_mantencion') {
            await buildAndPersistEquipmentCostMatrix(globalAssetId).catch(() => null);
        }

        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_ITEM_DISCARDED',
            targetEntity: `global_asset_catalog/${globalAssetId}/knowledge_vault/${pillarId}/${itemId}`,
            details: {
                pillarId,
                itemId,
                title: items[idx].title,
                actorEmail: ctx.actorEmail,
            },
        }).catch(() => undefined);

        return res.status(200).json({ success: true });
    } catch (err) {
        return handleVaultError(res, err, 'Error descartando ítem.');
    }
});

vaultRouter.post('/discard-suggested-item', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const { globalAssetId, pillarId, title, section, rationale, source } = req.body || {};

    if (!globalAssetId || !pillarId || !title || !section) {
        return res.status(400).json({ error: 'Parámetros requeridos: globalAssetId, pillarId, title, section.' });
    }

    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
            globalAssetId,
            (req as any).catalogDocSnap
        );
        if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Catálogo no encontrado.' });

        const pillar = hydrated.data.knowledge_vault?.[pillarId];
        if (!pillar) return res.status(404).json({ error: 'Pilar no encontrado.' });

        const updatedPending = (pillar.suggested_items_pending || []).filter(
            (it: any) => String(it.title || '').toLowerCase().trim() !== String(title).toLowerCase().trim()
        );

        const newItem = {
            item_id: `manual_${randomUUID().substring(0, 8)}`,
            title,
            section,
            rationale: rationale || 'Sugerencia descartada.',
            priority: 'IMPORTANTE',
            order: 999,
            content_status: 'PENDIENTE',
            content: null,
            is_discarded: true,
            created_at: new Date().toISOString(),
            created_by: ctx.actorEmail,
            discarded_at: new Date().toISOString(),
            discarded_by: ctx.actorEmail,
            historial_cambios: [
                {
                    fecha: new Date().toISOString(),
                    accion: 'DESCARTE_SUGERENCIA_IA',
                    actor: ctx.actorEmail,
                    detalle: `Sugerencia descartada: "${title}".`,
                },
            ],
            item_sources: source
                ? [{ type: source.type, author: source.author, description: source.description, url: source.url }]
                : [],
        };

        const finalItems = reindexPillarItems([...(pillar.items || []), newItem]);
        await VaultPersistenceService.savePillarDocument({
            globalAssetId,
            pillarId: pillarId as PillarId,
            pillarDoc: {
                ...pillar,
                pillar_id: pillarId as PillarId,
                items: finalItems,
                suggested_items_pending: updatedPending,
                updated_at: new Date().toISOString(),
            },
        });

        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_SUGGESTION_DISCARDED',
            targetEntity: `global_asset_catalog/${globalAssetId}/knowledge_vault/${pillarId}/${newItem.item_id}`,
            details: {
                pillarId,
                title,
                actorEmail: ctx.actorEmail,
            },
        }).catch(() => undefined);

        return res.status(200).json({ success: true });
    } catch (err) {
        return handleVaultError(res, err, 'Error descartando sugerencia.');
    }
});

vaultRouter.post('/reactivate-item', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const { globalAssetId, pillarId, itemId, confirmWord } = req.body || {};
    if (!globalAssetId || !pillarId || !itemId) {
        return res.status(400).json({ error: 'Parámetros requeridos: globalAssetId, pillarId, itemId.' });
    }
    if (confirmWord !== undefined && String(confirmWord).trim().toUpperCase() !== HITL_CONFIRM_KEYWORD) {
        return res.status(400).json({ error: `Debe confirmar escribiendo "${HITL_CONFIRM_KEYWORD}".` });
    }

    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
            globalAssetId,
            (req as any).catalogDocSnap
        );
        if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Catálogo no encontrado.' });

        const pillar = hydrated.data.knowledge_vault?.[pillarId];
        if (!pillar) return res.status(404).json({ error: 'Pilar no encontrado.' });

        const items = [...(pillar.items || [])];
        const idx = items.findIndex((it: any) => it.item_id === itemId);
        if (idx === -1) return res.status(404).json({ error: 'Ítem no encontrado.' });

        items[idx] = {
            ...items[idx],
            is_discarded: false,
            reactivated_at: new Date().toISOString(),
        };

        const finalItems = sortAndReindexPillarItems(pillarId as PillarId, items);
        const newStructureDigest = computePillarStructureDigestSha256(finalItems);
        const nextPillarDoc = {
            ...pillar,
            pillar_id: pillarId as PillarId,
            items: finalItems,
            structure_digest_sha256: newStructureDigest,
            updated_at: new Date().toISOString(),
        };
        const nextVault = {
            ...(hydrated.data.knowledge_vault || {}),
            [pillarId]: nextPillarDoc,
        };
        const newMerkleRoot = computeVaultMerkleRootSha256(nextVault);

        await VaultPersistenceService.savePillarDocument({
            globalAssetId,
            pillarId: pillarId as PillarId,
            pillarDoc: nextPillarDoc,
            vaultMerkleRootSha256: newMerkleRoot,
        });

        if (pillarId === 'ficha_tecnica' || pillarId === 'pauta_mantencion') {
            await buildAndPersistEquipmentCostMatrix(globalAssetId).catch(() => null);
        }

        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_ITEM_REACTIVATED',
            targetEntity: `global_asset_catalog/${globalAssetId}/knowledge_vault/${pillarId}/${itemId}`,
            details: {
                pillarId,
                itemId,
                title: items[idx].title,
                actorEmail: ctx.actorEmail,
            },
        }).catch(() => undefined);

        return res.status(200).json({ success: true });
    } catch (err) {
        return handleVaultError(res, err, 'Error reactivando ítem.');
    }
});

vaultRouter.post(
    '/attach-image',
    requireCurateAI,
    checkVaultNotSealed,
    upload.single('image'),
    async (req: ScopedRequest, res: Response) => {
        const file = req.file;
        const { globalAssetId, activeTab, targetIndex, imageUrl } = req.body || {};

        if ((!file && !imageUrl) || !globalAssetId || !activeTab || targetIndex === undefined) {
            return res.status(400).json({
                error: 'Parámetros requeridos: archivo image (o imageUrl HTTPS segura), globalAssetId, activeTab, targetIndex.',
            });
        }

        try {
            const ctx = req.opermaqContext!;
            let imgBuffer: Buffer;
            let imgMime: string;
            let originalFilename: string;

            if (file) {
                imgBuffer = file.buffer;
                imgMime = file.mimetype || 'image/jpeg';
                originalFilename = file.originalname || 'adjunto_tecnico.webp';
            } else {
                const remoteUrlStr = String(imageUrl).trim();
                const remoteRes = await safeFetchExternal(remoteUrlStr, {
                    method: 'GET',
                    maxBytes: 15 * 1024 * 1024,
                    headers: { Accept: 'image/*;q=0.9,*/*;q=0.1' },
                });
                if (!remoteRes.ok) {
                    return res.status(400).json({
                        error: `No se pudo descargar la imagen remota (HTTP ${remoteRes.status}).`,
                    });
                }
                const cType = (remoteRes.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
                if (!cType.startsWith('image/')) {
                    return res.status(400).json({
                        error: 'La URL externa no corresponde a un recurso de imagen válido.',
                    });
                }
                imgBuffer = Buffer.from(await remoteRes.arrayBuffer());
                imgMime = cType;
                originalFilename = 'remote_technical_attachment.webp';
            }

            const { descriptor } = await CasStorageService.digestAndStore(
                imgBuffer,
                imgMime,
                'IMAGE_TECHNICAL_HD',
                {
                    scope: 'GLOBAL_OEM',
                    actorUid: ctx.actorId,
                    originalFilename,
                }
            );

            return res.status(200).json({
                success: true,
                imageUrl: descriptor.downloadUrl,
                sha256: descriptor.sha256,
                originalBytes: descriptor.originalBytes,
                optimizedBytes: descriptor.optimizedBytes,
                savingsRatio: descriptor.savingsRatio,
                savingsPct: descriptor.savingsPct ?? Number((descriptor.savingsRatio * 100).toFixed(1)),
                deduplicatedHit: descriptor.deduplicatedHit,
            });
        } catch (err) {
            return handleVaultError(res, err, 'Error adjuntando imagen técnica.');
        }
    }
);

vaultRouter.post(
    '/update-item-approval-state',
    checkVaultNotSealed,
    async (req: ScopedRequest, res: Response) => {
        const ctx = req.opermaqContext!;
        if (!ctx.capabilities.canCurateAI) {
            return res.status(403).json({ error: 'Permisos insuficientes para aprobación HITL.' });
        }

        const schema = z.object({
            globalAssetId: z.string().min(1),
            pillarId: z.string().min(1),
            itemId: z.string().min(1),
            nuevo_estado: z.enum(['REQUIERE_CAMBIOS', 'APROBADO_HUMANO', 'GENERADO_IA']),
            review_notes: z.string().optional(),
        });

        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Parámetros inválidos.', details: parsed.error.format() });
        }

        const { globalAssetId, pillarId, itemId, nuevo_estado, review_notes } = parsed.data;

        try {
            const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
                globalAssetId,
                (req as any).catalogDocSnap
            );
            if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Catálogo no encontrado.' });

            const pillar = hydrated.data.knowledge_vault?.[pillarId];
            if (!pillar) return res.status(404).json({ error: 'Pilar no encontrado.' });

            const items = [...(pillar.items || [])];
            const idx = items.findIndex((it: any) => it.item_id === itemId);
            if (idx === -1) return res.status(404).json({ error: 'Ítem no encontrado.' });

            const item = { ...items[idx] };
            item.estado_aprobacion = nuevo_estado;
            item.historial_cambios = item.historial_cambios || [];

            if (nuevo_estado === 'REQUIERE_CAMBIOS') {
                if (!review_notes?.trim()) {
                    return res.status(400).json({ error: 'review_notes es requerido para REQUIERE_CAMBIOS.' });
                }
                item.review_notes = review_notes.trim();
                delete item.approved_by;
                delete item.approved_at;
                item.is_human_locked = false;
                item.historial_cambios.push({
                    fecha: new Date().toISOString(),
                    accion: 'SOLICITUD_CORRECCION',
                    actor: ctx.actorEmail,
                    detalle: review_notes.trim(),
                });
            } else if (nuevo_estado === 'APROBADO_HUMANO') {
                delete item.review_notes;
                item.approved_by = ctx.actorEmail;
                item.approved_at = new Date().toISOString();
                item.is_human_locked = true;
                item.historial_cambios.push({
                    fecha: item.approved_at,
                    accion: 'APROBACION_FINAL',
                    actor: ctx.actorEmail,
                    detalle: 'Ítem validado por experto y bloqueado contra sobrescritura IA.',
                });
            } else {
                delete item.review_notes;
                item.is_human_locked = false;
            }

            items[idx] = item;
            await propagateItemContentMutationEffects({
                globalAssetId,
                pillarId: pillarId as PillarId,
                itemId,
                updatedItem: item,
                updatedItems: items,
                existingVault: hydrated.data.knowledge_vault,
            });

            void AuditLedger.record({
                tenantId: ctx.tenantId || 'GLOBAL_OEM',
                actorUid: ctx.actorId,
                actorEmail: ctx.actorEmail,
                module: 'opermaq',
                action: `VAULT_ITEM_APPROVAL_${nuevo_estado}`,
                targetEntity: `global_asset_catalog/${globalAssetId}/pillars/${pillarId}/${itemId}`,
                details: { pillarId, itemId, nuevo_estado },
            }).catch(() => undefined);

            return res.status(200).json({ success: true, estado: nuevo_estado });
        } catch (err) {
            return handleVaultError(res, err, 'Error actualizando estado de aprobación HITL.');
        }
    }
);

vaultRouter.post('/bulk-approve', checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    if (!ctx.capabilities.canCurateAI) {
        return res.status(403).json({ error: 'Permisos insuficientes para aprobación masiva HITL.' });
    }

    const schema = z.object({
        confirmWord: z.string().optional(),
        items: z.array(
            z.object({
                globalAssetId: z.string(),
                pillarId: z.string(),
                itemId: z.string(),
            })
        ),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Formato inválido.' });
    if (
        parsed.data.confirmWord !== undefined &&
        parsed.data.confirmWord.trim().toUpperCase() !== HITL_CONFIRM_KEYWORD
    ) {
        return res.status(400).json({ error: `Debe confirmar escribiendo "${HITL_CONFIRM_KEYWORD}".` });
    }

    const { items } = parsed.data;
    const now = new Date().toISOString();

    try {
        const catalogMap = new Map<string, Record<string, any>>();
        const mutatedPillarsByAsset = new Map<string, Set<PillarId>>();

        for (const it of items) {
            if (!catalogMap.has(it.globalAssetId)) {
                const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(it.globalAssetId);
                if (hydrated.exists && hydrated.data) {
                    catalogMap.set(it.globalAssetId, hydrated.data);
                }
            }
        }

        let approved = 0;
        for (const it of items) {
            const catalogData = catalogMap.get(it.globalAssetId);
            const pillarDoc = catalogData?.knowledge_vault?.[it.pillarId];
            if (!pillarDoc || !Array.isArray(pillarDoc.items) || !VALID_PILLAR_IDS.includes(it.pillarId as PillarId)) {
                continue;
            }

            const idx = pillarDoc.items.findIndex((pi: any) => pi.item_id === it.itemId);
            if (idx === -1) continue;

            pillarDoc.items[idx] = {
                ...pillarDoc.items[idx],
                estado_aprobacion: 'APROBADO_HUMANO',
                approved_by: ctx.actorEmail,
                approved_at: now,
                is_human_locked: true,
                historial_cambios: [
                    ...(pillarDoc.items[idx].historial_cambios || []),
                    {
                        fecha: now,
                        accion: 'APROBACION_BATCH',
                        actor: ctx.actorEmail,
                        detalle: 'Aprobación HITL por lote.',
                    },
                ],
            };
            pillarDoc.updated_at = now;
            if (!mutatedPillarsByAsset.has(it.globalAssetId)) {
                mutatedPillarsByAsset.set(it.globalAssetId, new Set());
            }
            mutatedPillarsByAsset.get(it.globalAssetId)!.add(it.pillarId as PillarId);
            approved++;
        }

        for (const [assetId, pidSet] of mutatedPillarsByAsset.entries()) {
            const catalogData = catalogMap.get(assetId);
            if (!catalogData) continue;
            const pillarsToSave: Partial<Record<PillarId, any>> = {};
            for (const pid of pidSet) {
                const pDoc = catalogData.knowledge_vault?.[pid];
                if (pDoc) {
                    pDoc.content_digest_sha256 = computePillarContentDigestSha256(pDoc.items || []);
                    pillarsToSave[pid] = pDoc;
                }
            }
            const merkleRoot = computeVaultMerkleRootSha256(catalogData.knowledge_vault);
            await VaultPersistenceService.saveMultiplePillars({
                globalAssetId: assetId,
                pillars: pillarsToSave,
                vaultMerkleRootSha256: merkleRoot,
            });
            void AuditLedger.record({
                tenantId: ctx.tenantId || 'GLOBAL_OEM',
                actorUid: ctx.actorId,
                actorEmail: ctx.actorEmail,
                module: 'opermaq',
                action: 'VAULT_ITEMS_BULK_APPROVED',
                targetEntity: `global_asset_catalog/${assetId}`,
                details: { pillars: Array.from(pidSet), approved },
            }).catch(() => undefined);
        }

        return res.status(200).json({ success: true, approved });
    } catch (err) {
        return handleVaultError(res, err, 'Error en aprobación HITL por lote.');
    }
});

vaultRouter.post('/update-item-content', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const schema = z.object({
        globalAssetId: z.string(),
        pillarId: z.string(),
        itemId: z.string(),
        newContent: z.string(),
        confirmWord: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Parámetros inválidos.' });

    const { globalAssetId, pillarId, itemId, newContent, confirmWord } = parsed.data;
    if (confirmWord !== undefined && confirmWord.trim().toUpperCase() !== HITL_CONFIRM_KEYWORD) {
        return res.status(400).json({ error: `Debe confirmar escribiendo "${HITL_CONFIRM_KEYWORD}".` });
    }

    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
            globalAssetId,
            (req as any).catalogDocSnap
        );
        if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Catálogo no encontrado.' });

        const pillar = hydrated.data.knowledge_vault?.[pillarId];
        if (!pillar || !Array.isArray(pillar.items)) {
            return res.status(404).json({ error: 'Pilar no encontrado.' });
        }

        const items = [...pillar.items];
        const idx = items.findIndex((it: any) => it.item_id === itemId);
        if (idx === -1) return res.status(404).json({ error: 'Ítem no encontrado.' });
        if (items[idx].is_human_locked === true) {
            return res.status(403).json({ error: 'Ítem bloqueado por autoridad humana.' });
        }

        const sanitized = await sanitizeAndEnrichItemContentForSave(
            String(newContent),
            pillarId as PillarId
        );
        const oldContent = items[idx].content;
        const nextHistory = await VaultPersistenceService.appendItemRevision({
            globalAssetId,
            pillarId: pillarId as PillarId,
            itemId,
            existingHistory: items[idx].historial_cambios,
            accion: 'EDICION_HITL',
            actor: ctx.actorEmail,
            detalle: 'Edición quirúrgica manual.',
            snapshotAnterior: oldContent,
        });

        items[idx] = {
            ...items[idx],
            content: sanitized.content,
            symbology_refs: sanitized.symbologyRefs,
            content_status: 'COMPLETADO',
            last_edit_by: ctx.actorEmail,
            historial_cambios: nextHistory,
        };

        await propagateItemContentMutationEffects({
            globalAssetId,
            pillarId: pillarId as PillarId,
            itemId,
            updatedItem: items[idx],
            updatedItems: items,
            existingVault: hydrated.data.knowledge_vault,
        });

        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_ITEM_CONTENT_HITL_UPDATED',
            targetEntity: `global_asset_catalog/${globalAssetId}/pillars/${pillarId}/${itemId}`,
            details: { pillarId, itemId },
        }).catch(() => undefined);

        return res.status(200).json({ success: true, content: sanitized.content });
    } catch (err) {
        return handleVaultError(res, err, 'Error guardando contenido del ítem.');
    }
});

vaultRouter.post('/resolve-item-conflict', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const { globalAssetId, pillarId, itemId, action, proposal } = req.body || {};

    if (!globalAssetId || !pillarId || !itemId || !action || !proposal) {
        return res.status(400).json({ error: 'Parámetros requeridos incompletos.' });
    }
    if (!['ACCEPT', 'REJECT'].includes(action)) {
        return res.status(400).json({ error: 'action debe ser ACCEPT o REJECT.' });
    }

    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
            globalAssetId,
            (req as any).catalogDocSnap
        );
        if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Catálogo no encontrado.' });

        const pillar = hydrated.data.knowledge_vault?.[pillarId];
        if (!pillar) return res.status(404).json({ error: 'Pilar no encontrado.' });

        const items = [...(pillar.items || [])];
        const idx = items.findIndex((it: any) => it.item_id === itemId);
        if (idx === -1) return res.status(404).json({ error: 'Ítem no encontrado.' });
        if (items[idx].is_human_locked === true) {
            return res.status(403).json({ error: 'Ítem bloqueado por autoridad humana.' });
        }

        const item = { ...items[idx] };
        const finalPending = (item.pending_conflicts || []).filter(
            (p: any) => p.proposal_id !== proposal.proposal_id
        );

        if (action === 'ACCEPT') {
            const filteredBuffer = (item.authorized_delta_buffer || []).filter(
                (it: any) =>
                    !(it.componente === proposal.componente && it.zona === proposal.zona) &&
                    it.proposal_id !== proposal.proposal_id
            );
            item.authorized_delta_buffer = [
                ...filteredBuffer,
                {
                    ...proposal,
                    authorized_at: new Date().toISOString(),
                    authorized_by: ctx.actorEmail,
                    status: 'AUTHORIZED',
                },
            ];
            item.historial_cambios = [
                ...(item.historial_cambios || []),
                {
                    fecha: new Date().toISOString(),
                    accion: 'PROPUESTA_ACEPTADA',
                    actor: ctx.actorEmail,
                    detalle: `Propuesta autorizada para ${proposal.componente}.`,
                },
            ];
        }

        item.pending_conflicts = finalPending;
        items[idx] = item;
        await VaultPersistenceService.savePillarDocument({
            globalAssetId,
            pillarId: pillarId as PillarId,
            pillarDoc: {
                ...pillar,
                pillar_id: pillarId as PillarId,
                items,
                updated_at: new Date().toISOString(),
            },
        });

        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: `VAULT_ITEM_CONFLICT_${action}`,
            targetEntity: `global_asset_catalog/${globalAssetId}/pillars/${pillarId}/${itemId}`,
            details: { pillarId, itemId, proposalId: proposal?.proposal_id || null, action },
        }).catch(() => undefined);

        return res.status(200).json({
            success: true,
            pendingCount: finalPending.length,
            authorizedCount: action === 'ACCEPT' ? 1 : 0,
        });
    } catch (err) {
        return handleVaultError(res, err, 'Error resolviendo conflicto de ítem.');
    }
});

vaultRouter.post(
    '/resolve-item-conflicts-bulk',
    requireCurateAI,
    checkVaultNotSealed,
    async (req: ScopedRequest, res: Response) => {
        const ctx = req.opermaqContext!;
        const schema = z.object({
            globalAssetId: z.string().min(1),
            pillarId: z.string().min(1),
            itemId: z.string().min(1),
            action: z.enum(['ACCEPT', 'REJECT']),
            proposals: z.array(z.any()),
        });

        const parsed = schema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Parámetros inválidos.' });

        const { globalAssetId, pillarId, itemId, action, proposals } = parsed.data;

        try {
            const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
                globalAssetId,
                (req as any).catalogDocSnap
            );
            if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Catálogo no encontrado.' });

            const pillar = hydrated.data.knowledge_vault?.[pillarId];
            if (!pillar) return res.status(404).json({ error: 'Pilar no encontrado.' });

            const items = [...(pillar.items || [])];
            const idx = items.findIndex((it: any) => it.item_id === itemId);
            if (idx === -1) return res.status(404).json({ error: 'Ítem no encontrado.' });
            if (items[idx].is_human_locked === true) {
                return res.status(403).json({ error: 'Ítem bloqueado por autoridad humana.' });
            }

            const item = { ...items[idx] };
            const ids = new Set(proposals.map((p: any) => p.proposal_id));
            const finalPending = (item.pending_conflicts || []).filter((p: any) => !ids.has(p.proposal_id));

            if (action === 'ACCEPT') {
                let buffer = [...(item.authorized_delta_buffer || [])];
                item.historial_cambios = item.historial_cambios || [];
                for (const proposal of proposals) {
                    buffer = buffer.filter(
                        (it: any) =>
                            !(it.componente === proposal.componente && it.zona === proposal.zona) &&
                            it.proposal_id !== proposal.proposal_id
                    );
                    buffer.push({
                        ...proposal,
                        authorized_at: new Date().toISOString(),
                        authorized_by: ctx.actorEmail,
                        status: 'AUTHORIZED',
                    });
                    item.historial_cambios.push({
                        fecha: new Date().toISOString(),
                        accion: 'PROPUESTA_ACEPTADA',
                        actor: ctx.actorEmail,
                        detalle: `Propuesta autorizada para ${proposal.componente}.`,
                    });
                }
                item.authorized_delta_buffer = buffer;
            }

            item.pending_conflicts = finalPending;
            items[idx] = item;
            await VaultPersistenceService.savePillarDocument({
                globalAssetId,
                pillarId: pillarId as PillarId,
                pillarDoc: {
                    ...pillar,
                    pillar_id: pillarId as PillarId,
                    items,
                    updated_at: new Date().toISOString(),
                },
            });

            void AuditLedger.record({
                tenantId: ctx.tenantId || 'GLOBAL_OEM',
                actorUid: ctx.actorId,
                actorEmail: ctx.actorEmail,
                module: 'opermaq',
                action: `VAULT_ITEM_CONFLICTS_BULK_${action}`,
                targetEntity: `global_asset_catalog/${globalAssetId}/pillars/${pillarId}/${itemId}`,
                details: { pillarId, itemId, count: proposals.length, action },
            }).catch(() => undefined);

            return res.status(200).json({
                success: true,
                pendingCount: finalPending.length,
                authorizedCount: action === 'ACCEPT' ? proposals.length : 0,
            });
        } catch (err) {
            return handleVaultError(res, err, 'Error resolviendo conflictos en lote.');
        }
    }
);

function buildFallbackProposalKey(p: any, idx?: number): string {
    const estado = String(p?.estado_fusion || 'NUEVO').trim();
    const comp = String(p?.componente || '').trim();
    const val = String(p?.valor_nuevo || '').trim().slice(0, 80);
    return idx !== undefined
        ? `fallback_${estado}::${comp}::${val}::${idx}`
        : `fallback_${estado}::${comp}::${val}`;
}

function matchPendingProposalIndex(pendingList: any[], proposalId: string): number {
    const exactIdx = pendingList.findIndex((p: any) => p.proposal_id === proposalId);
    if (exactIdx !== -1) return exactIdx;

    const withIdxMatch = pendingList.findIndex(
        (p: any, i: number) => buildFallbackProposalKey(p, i) === proposalId
    );
    if (withIdxMatch !== -1) return withIdxMatch;

    const withoutIdxMatch = pendingList.findIndex(
        (p: any) => buildFallbackProposalKey(p) === proposalId
    );
    return withoutIdxMatch;
}

vaultRouter.post('/decide-proposal', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const schema = z.object({
        globalAssetId: z.string().min(1),
        pillarId: z.string().min(1),
        itemId: z.string().min(1),
        proposalId: z.string().min(1),
        decision: z.enum(['APROBADO', 'ELIMINADO']),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Parámetros inválidos.' });

    const { globalAssetId, pillarId, itemId, proposalId, decision } = parsed.data;

    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
            globalAssetId,
            (req as any).catalogDocSnap
        );
        if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Catálogo no encontrado.' });

        const data = hydrated.data;
        const pillar = data.knowledge_vault?.[pillarId];
        if (!pillar) return res.status(404).json({ error: 'Pilar no encontrado.' });

        const items = [...(pillar.items || [])];
        const idx = items.findIndex((it: any) => it.item_id === itemId);
        if (idx === -1) return res.status(404).json({ error: 'Ítem no encontrado.' });
        if (items[idx].is_human_locked === true) {
            return res.status(403).json({ error: 'Ítem bloqueado por autoridad humana.' });
        }

        const item = { ...items[idx] };
        const currentPending = [...(item.pending_conflicts || [])];
        const pIdx = matchPendingProposalIndex(currentPending, proposalId);
        if (pIdx === -1) return res.status(404).json({ error: 'Propuesta no encontrada.' });

        const proposal = {
            ...currentPending[pIdx],
            proposal_id: currentPending[pIdx].proposal_id || proposalId,
            human_decision: decision,
            decided_at: new Date().toISOString(),
            decided_by: ctx.actorEmail,
        };
        currentPending[pIdx] = proposal;

        const targetFusionType: 'NUEVO' | 'CONFLICTO' =
            proposal.estado_fusion === 'CONFLICTO' ? 'CONFLICTO' : 'NUEVO';

        if (decision === 'ELIMINADO') {
            const rejectedFp =
                proposal.fact_fingerprint ||
                computeFactFingerprint(proposal.valor_nuevo || '', item.title || proposal.componente || '');
            const prevRejected: string[] = Array.isArray(item.rejected_fact_fingerprints)
                ? item.rejected_fact_fingerprints
                : [];
            if (rejectedFp && !prevRejected.includes(rejectedFp)) {
                item.rejected_fact_fingerprints = [...prevRejected.slice(-199), rejectedFp];
            }

            const remainingPending = currentPending.filter(
                (p: any, i: number) => i !== pIdx && p.human_decision !== 'ELIMINADO'
            );
            item.pending_conflicts = remainingPending;
            item.historial_cambios = [
                ...(item.historial_cambios || []),
                {
                    fecha: new Date().toISOString(),
                    accion: 'PROPUESTA_ELIMINADA',
                    actor: ctx.actorEmail,
                    detalle: `Decisión ELIMINADO para ${proposal.componente}.`,
                },
            ];
            item.last_edit_by = ctx.actorEmail;
            items[idx] = item;

            await propagateItemContentMutationEffects({
                globalAssetId,
                pillarId: pillarId as PillarId,
                itemId,
                updatedItem: item,
                updatedItems: items,
                existingVault: data.knowledge_vault,
            });

            const remainingCount = remainingPending.filter(
                (p: any) => p.estado_fusion === targetFusionType && p.human_decision !== 'ELIMINADO' && p.human_decision !== 'APROBADO'
            ).length;

            return res.status(200).json({
                success: true,
                decision,
                proposalId,
                remainingCount,
                autoConsolidated: false,
            });
        }

        // decision === 'APROBADO': Consolidación inmediata en item.content + remoción física de pending_conflicts
        const deltas = currentPending.filter(
            (p: any) => p.estado_fusion === targetFusionType && p.human_decision === 'APROBADO'
        );

        const make = String(data.make_oficial || data.make || '').trim();
        const model = String(data.model_oficial || data.model || '').trim();
        const makeModel = `${make} ${model}`.trim() || globalAssetId;
        const currentContent = item.content || '';

        const evolvedContent = await evolveItemContent({
            makeModel,
            itemTitle: item.title,
            currentContent,
            deltas,
            pillarId: pillarId as PillarId,
        });

        item.historial_cambios = await VaultPersistenceService.appendItemRevision({
            globalAssetId,
            pillarId: pillarId as PillarId,
            itemId,
            existingHistory: item.historial_cambios,
            accion: targetFusionType === 'NUEVO' ? 'EVOLUCION_NUEVO_CONTENIDO' : 'EVOLUCION_CONFLICTOS',
            actor: ctx.actorEmail,
            detalle: `Aprobación e integración inmediata de ${deltas.length} hallazgo(s) ${targetFusionType} (${proposal.componente}).`,
            snapshotAnterior: currentContent,
        });

        const remainingPending = currentPending.filter(
            (p: any) =>
                p.human_decision !== 'ELIMINADO' &&
                !(p.estado_fusion === targetFusionType && p.human_decision === 'APROBADO')
        );

        item.item_sources = item.item_sources || [];
        const existingFingerprints = new Set<string>(item.fact_fingerprints || []);
        let incomingFigures: ExtractedFigureRef[] = [];

        for (const d of deltas) {
            if (d.source_url && d.source_url.trim() && d.source_url.trim() !== '#') {
                const urlStr = d.source_url.trim();
                if (!item.item_sources.some((s: any) => s.url === urlStr)) {
                    item.item_sources.push({
                        type: d.is_oem ? 'OEM' : 'EXTERNO',
                        author: make || 'Fabricante',
                        description: `${d.componente} (${d.zona})`,
                        url: urlStr,
                    });
                }
            }
            if (d.valor_nuevo) {
                existingFingerprints.add(computeFactFingerprint(d.valor_nuevo, d.componente || ''));
            }
            if (Array.isArray(d.figures) && d.figures.length > 0) {
                incomingFigures = incomingFigures.concat(d.figures);
            }
        }

        if (incomingFigures.length > 0) {
            const { merged } = mergeDeduplicatedFigures(item.figures || [], incomingFigures);
            item.figures = merged;
        }
        item.fact_fingerprints = Array.from(existingFingerprints);

        const sanitized = await sanitizeAndEnrichItemContentForSave(
            evolvedContent,
            pillarId as PillarId
        );
        item.content = sanitized.content;
        item.symbology_refs = sanitized.symbologyRefs;
        item.pending_conflicts = remainingPending;
        item.authorized_delta_buffer = [];
        item.estado_aprobacion = 'GENERADO_IA';
        item.last_edit_by = ctx.actorEmail;
        items[idx] = item;

        await propagateItemContentMutationEffects({
            globalAssetId,
            pillarId: pillarId as PillarId,
            itemId,
            updatedItem: item,
            updatedItems: items,
            existingVault: data.knowledge_vault,
        });

        const remainingCount = remainingPending.filter(
            (p: any) => p.estado_fusion === targetFusionType && p.human_decision !== 'ELIMINADO' && p.human_decision !== 'APROBADO'
        ).length;

        return res.status(200).json({
            success: true,
            decision,
            proposalId,
            remainingCount,
            evolvedContent: sanitized.content,
            autoConsolidated: true,
        });
    } catch (err) {
        return handleVaultError(res, err, 'Error registrando decisión sobre propuesta.');
    }
});

vaultRouter.post('/evolve-item', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const schema = z.object({
        globalAssetId: z.string().min(1),
        pillarId: z.string().min(1),
        itemId: z.string().min(1),
        filterType: z.enum(['NUEVO', 'CONFLICTO']),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Parámetros inválidos.' });

    const { globalAssetId, pillarId, itemId, filterType } = parsed.data;

    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
            globalAssetId,
            (req as any).catalogDocSnap
        );
        if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Catálogo no encontrado.' });

        const data = hydrated.data;
        const pillar = data.knowledge_vault?.[pillarId];
        if (!pillar) return res.status(404).json({ error: 'Pilar no encontrado.' });

        const items = [...(pillar.items || [])];
        const idx = items.findIndex((it: any) => it.item_id === itemId);
        if (idx === -1) return res.status(404).json({ error: 'Ítem no encontrado.' });
        if (items[idx].is_human_locked === true) {
            return res.status(403).json({ error: 'Ítem bloqueado por autoridad humana.' });
        }

        const item = { ...items[idx] };
        const currentContent = item.content || '';
        const currentPending = item.pending_conflicts || [];
        const deltas = currentPending.filter(
            (p: any) => p.estado_fusion === filterType && p.human_decision === 'APROBADO'
        );

        if (deltas.length === 0) {
            return res.status(400).json({
                error: `Sin propuestas ${filterType} aprobadas para consolidar.`,
            });
        }

        const make = String(data.make_oficial || data.make || '').trim();
        const model = String(data.model_oficial || data.model || '').trim();
        const makeModel = `${make} ${model}`.trim() || globalAssetId;

        const evolvedContent = await evolveItemContent({
            makeModel,
            itemTitle: item.title,
            currentContent,
            deltas,
            pillarId: pillarId as PillarId,
        });

        item.historial_cambios = await VaultPersistenceService.appendItemRevision({
            globalAssetId,
            pillarId: pillarId as PillarId,
            itemId,
            existingHistory: item.historial_cambios,
            accion: filterType === 'NUEVO' ? 'EVOLUCION_NUEVO_CONTENIDO' : 'EVOLUCION_CONFLICTOS',
            actor: ctx.actorEmail,
            detalle: `Fusión evolutiva de ${deltas.length} hallazgo(s) ${filterType}.`,
            snapshotAnterior: currentContent,
        });

        const remainingPending = currentPending.filter(
            (p: any) =>
                p.human_decision !== 'ELIMINADO' &&
                !(
                    p.estado_fusion === filterType &&
                    (p.human_decision === 'APROBADO' || p.human_decision === 'ELIMINADO')
                )
        );

        item.item_sources = item.item_sources || [];
        const existingFingerprints = new Set<string>(item.fact_fingerprints || []);
        let incomingFigures: ExtractedFigureRef[] = [];

        for (const d of deltas) {
            if (d.source_url && d.source_url.trim() && d.source_url.trim() !== '#') {
                const urlStr = d.source_url.trim();
                if (!item.item_sources.some((s: any) => s.url === urlStr)) {
                    item.item_sources.push({
                        type: d.is_oem ? 'OEM' : 'EXTERNO',
                        author: make || 'Fabricante',
                        description: `${d.componente} (${d.zona})`,
                        url: urlStr,
                    });
                }
            }
            if (d.valor_nuevo) {
                existingFingerprints.add(computeFactFingerprint(d.valor_nuevo, d.componente || ''));
            }
            if (Array.isArray(d.figures) && d.figures.length > 0) {
                incomingFigures = incomingFigures.concat(d.figures);
            }
        }

        if (incomingFigures.length > 0) {
            const { merged } = mergeDeduplicatedFigures(item.figures || [], incomingFigures);
            item.figures = merged;
        }
        item.fact_fingerprints = Array.from(existingFingerprints);

        const sanitized = await sanitizeAndEnrichItemContentForSave(
            evolvedContent,
            pillarId as PillarId
        );
        item.content = sanitized.content;
        item.symbology_refs = sanitized.symbologyRefs;
        item.pending_conflicts = remainingPending;
        item.authorized_delta_buffer = [];
        item.estado_aprobacion = 'GENERADO_IA';
        item.last_edit_by = ctx.actorEmail;
        items[idx] = item;

        await propagateItemContentMutationEffects({
            globalAssetId,
            pillarId: pillarId as PillarId,
            itemId,
            updatedItem: item,
            updatedItems: items,
            existingVault: data.knowledge_vault,
        });

        return res.status(200).json({ success: true, evolvedContent: sanitized.content });
    } catch (err) {
        return handleVaultError(res, err, 'Error evolucionando contenido del ítem.');
    }
});

vaultRouter.post('/cancel-evolution', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const { globalAssetId, pillarId, itemId } = req.body || {};
    if (!globalAssetId || !pillarId || !itemId) {
        return res.status(400).json({ error: 'Parámetros requeridos: globalAssetId, pillarId, itemId.' });
    }

    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
            globalAssetId,
            (req as any).catalogDocSnap
        );
        if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Catálogo no encontrado.' });

        const pillar = hydrated.data.knowledge_vault?.[pillarId];
        if (!pillar) return res.status(404).json({ error: 'Pilar no encontrado.' });
        const items = [...(pillar.items || [])];
        const idx = items.findIndex((it: any) => it.item_id === itemId);
        if (idx === -1) return res.status(404).json({ error: 'Ítem no encontrado.' });

        const count = (items[idx].authorized_delta_buffer || []).length;
        items[idx] = {
            ...items[idx],
            authorized_delta_buffer: [],
            historial_cambios: [
                ...(items[idx].historial_cambios || []),
                {
                    fecha: new Date().toISOString(),
                    accion: 'EVOLUCION_CANCELADA',
                    actor: ctx.actorEmail,
                    detalle: `Descartados ${count} cambios en búfer.`,
                },
            ],
        };

        await VaultPersistenceService.savePillarDocument({
            globalAssetId,
            pillarId: pillarId as PillarId,
            pillarDoc: {
                ...pillar,
                pillar_id: pillarId as PillarId,
                items,
                updated_at: new Date().toISOString(),
            },
        });
        return res.status(200).json({ success: true });
    } catch (err) {
        return handleVaultError(res, err, 'Error cancelando evolución.');
    }
});

vaultRouter.post('/unlock-item', checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    if (!ctx.capabilities.canCurateAI) {
        return res.status(403).json({ error: 'Permisos insuficientes para desbloquear ítems.' });
    }

    const { globalAssetId, pillarId, itemId, confirmWord } = req.body || {};
    if (!globalAssetId || !pillarId || !itemId) {
        return res.status(400).json({ error: 'Parámetros requeridos: globalAssetId, pillarId, itemId.' });
    }
    if (confirmWord !== undefined && String(confirmWord).trim().toUpperCase() !== HITL_CONFIRM_KEYWORD) {
        return res.status(400).json({ error: `Debe confirmar escribiendo "${HITL_CONFIRM_KEYWORD}".` });
    }

    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
            globalAssetId,
            (req as any).catalogDocSnap
        );
        if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Catálogo no encontrado.' });

        const pillar = hydrated.data.knowledge_vault?.[pillarId];
        if (!pillar) return res.status(404).json({ error: 'Pilar no encontrado.' });
        const items = [...(pillar.items || [])];
        const idx = items.findIndex((it: any) => it.item_id === itemId);
        if (idx === -1) return res.status(404).json({ error: 'Ítem no encontrado.' });

        items[idx] = {
            ...items[idx],
            is_human_locked: false,
            estado_aprobacion: 'GENERADO_IA',
            historial_cambios: [
                ...(items[idx].historial_cambios || []),
                {
                    fecha: new Date().toISOString(),
                    accion: 'DESBLOQUEO_MANUAL',
                    actor: ctx.actorEmail,
                    detalle: 'Ítem desbloqueado manualmente.',
                },
            ],
        };

        await VaultPersistenceService.savePillarDocument({
            globalAssetId,
            pillarId: pillarId as PillarId,
            pillarDoc: {
                ...pillar,
                pillar_id: pillarId as PillarId,
                items,
                updated_at: new Date().toISOString(),
            },
        });
        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_ITEM_UNLOCKED',
            targetEntity: `global_asset_catalog/${globalAssetId}/pillars/${pillarId}/${itemId}`,
            details: { pillarId, itemId },
        }).catch(() => undefined);
        return res.status(200).json({ success: true });
    } catch (err) {
        return handleVaultError(res, err, 'Error desbloqueando ítem.');
    }
});

vaultRouter.post('/rollback-item-version', requireCurateAI, checkVaultNotSealed, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const { globalAssetId, pillarId, itemId, timestamp } = req.body || {};
    if (!globalAssetId || !pillarId || !itemId || !timestamp) {
        return res.status(400).json({
            error: 'Parámetros requeridos: globalAssetId, pillarId, itemId, timestamp.',
        });
    }

    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(
            globalAssetId,
            (req as any).catalogDocSnap
        );
        if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Catálogo no encontrado.' });

        const items = [...(hydrated.data.knowledge_vault?.[pillarId]?.items || [])];
        const idx = items.findIndex((it: any) => it.item_id === itemId);
        if (idx === -1) return res.status(404).json({ error: 'Ítem no encontrado.' });
        if (items[idx].is_human_locked === true) {
            return res.status(403).json({ error: 'Desbloquee el ítem antes de restaurar versión previa.' });
        }

        const targetEntry = (items[idx].historial_cambios || []).find(
            (h: any) => h.fecha === timestamp && (h.snapshot_anterior !== undefined || Boolean(h.revision_id))
        );
        if (!targetEntry) {
            return res.status(404).json({ error: 'Versión histórica no encontrada.' });
        }

        const resolvedSnapshot = await VaultPersistenceService.resolveRevisionSnapshot({
            globalAssetId,
            historyEntry: targetEntry,
        });
        if (resolvedSnapshot === null) {
            return res.status(404).json({ error: 'El snapshot histórico solicitado no está disponible.' });
        }

        const sanitized = await sanitizeAndEnrichItemContentForSave(
            String(resolvedSnapshot),
            pillarId as PillarId
        );
        const previous = items[idx].content || '';
        const nextHistory = await VaultPersistenceService.appendItemRevision({
            globalAssetId,
            pillarId: pillarId as PillarId,
            itemId,
            existingHistory: items[idx].historial_cambios,
            accion: 'REVERSION_HISTORICA',
            actor: ctx.actorEmail,
            detalle: `Restauración de versión ${timestamp}.`,
            snapshotAnterior: previous,
        });

        items[idx] = {
            ...items[idx],
            content: sanitized.content,
            symbology_refs: sanitized.symbologyRefs,
            estado_aprobacion: 'GENERADO_IA',
            last_edit_by: ctx.actorEmail,
            historial_cambios: nextHistory,
        };

        await propagateItemContentMutationEffects({
            globalAssetId,
            pillarId: pillarId as PillarId,
            itemId,
            updatedItem: items[idx],
            updatedItems: items,
            existingVault: hydrated.data.knowledge_vault,
        });
        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_ITEM_VERSION_ROLLED_BACK',
            targetEntity: `global_asset_catalog/${globalAssetId}/pillars/${pillarId}/${itemId}`,
            details: { pillarId, itemId, restoredTimestamp: timestamp },
        }).catch(() => undefined);
        return res.status(200).json({ success: true, restoredContent: sanitized.content });
    } catch (err) {
        return handleVaultError(res, err, 'Error restaurando versión previa.');
    }
});

// ── SELLADO Y LECTURA DEL CATÁLOGO CON SIMBOLOGÍA RESUELTA ───────────────────

vaultRouter.post('/seal/:globalAssetId', async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    if (!ctx.capabilities.canCurateAI) {
        return res.status(403).json({ error: 'Permisos insuficientes para sellar bóvedas maestras.' });
    }
    const confirmWord = req.body?.confirmWord;
    if (confirmWord !== undefined && String(confirmWord).trim().toUpperCase() !== HITL_CONFIRM_KEYWORD) {
        return res.status(400).json({ error: `Debe confirmar escribiendo "${HITL_CONFIRM_KEYWORD}".` });
    }

    const globalAssetId = String(req.params.globalAssetId);
    try {
        await db.collection('global_asset_catalog').doc(globalAssetId).set(
            {
                isSealed: true,
                is_sealed: true,
                knowledge_vault: { is_sealed: true },
                sealedAt: FieldValue.serverTimestamp(),
                sealedBy: ctx.actorEmail,
                updatedAt: Date.now(),
            },
            { merge: true }
        );
        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_CATALOG_SEALED',
            targetEntity: `global_asset_catalog/${globalAssetId}`,
            details: { globalAssetId },
        }).catch(() => undefined);
        return res.status(200).json({ success: true, isSealed: true });
    } catch (err) {
        return handleVaultError(res, err, 'Error sellando bóveda.');
    }
});

vaultRouter.post('/unseal/:globalAssetId', async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    if (!ctx.capabilities.canCurateAI) {
        return res.status(403).json({ error: 'Permisos insuficientes para desbloquear bóvedas selladas.' });
    }
    const confirmWord = req.body?.confirmWord;
    if (confirmWord !== undefined && String(confirmWord).trim().toUpperCase() !== HITL_CONFIRM_KEYWORD) {
        return res.status(400).json({ error: `Debe confirmar escribiendo "${HITL_CONFIRM_KEYWORD}".` });
    }

    const globalAssetId = String(req.params.globalAssetId);
    try {
        await db.collection('global_asset_catalog').doc(globalAssetId).set(
            {
                isSealed: false,
                is_sealed: false,
                knowledge_vault: { is_sealed: false },
                unsealedAt: FieldValue.serverTimestamp(),
                unsealedBy: ctx.actorEmail,
                updatedAt: Date.now(),
            },
            { merge: true }
        );
        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_CATALOG_UNSEALED',
            targetEntity: `global_asset_catalog/${globalAssetId}`,
            details: { globalAssetId },
        }).catch(() => undefined);
        return res.status(200).json({ success: true, isSealed: false });
    } catch (err) {
        return handleVaultError(res, err, 'Error desbloqueando bóveda.');
    }
});

vaultRouter.get('/asset/:globalAssetId', async (req: ScopedRequest, res: Response) => {
    const globalAssetId = String(req.params.globalAssetId);
    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(globalAssetId);
        if (!hydrated.exists || !hydrated.data) {
            return res.status(404).json({ exists: false, error: 'Activo no encontrado en el catálogo.' });
        }

        const rawData = hydrated.data;
        const vault = rawData.knowledge_vault || null;
        const storedMatrix = rawData.operational_cost_matrix;
        const currentMerkle = vault?.vault_merkle_root_sha256 || null;

        const effectiveCostMatrix =
            storedMatrix &&
            storedMatrix.version === '3.0.0' &&
            (!currentMerkle || storedMatrix.source_merkle_root_sha256 === currentMerkle)
                ? storedMatrix
                : compileEquipmentCostMatrixFromPillars({
                      assetData: rawData,
                      fichaDoc: vault?.ficha_tecnica || null,
                      mantencionDoc: vault?.pauta_mantencion || null,
                  });

        const resolved = await resolveAssetSymbology({
            id: hydrated.id,
            ...rawData,
            operational_cost_matrix: effectiveCostMatrix,
            energy_consumption_profile: effectiveCostMatrix.energy_consumption,
        });

        const projected = VaultPersistenceService.projectAssetForAudience(resolved, req.opermaqContext);
        return res.status(200).json({ exists: true, ...projected });
    } catch (err) {
        return handleVaultError(res, err, 'Error leyendo activo de catálogo.');
    }
});

// ── BÓVEDA GLOBAL DE SIMBOLOGÍA ISO 7000 / IEC 60417 ─────────────────────────

const SymbologySearchSchema = z.object({
    conceptId: z.string().trim().min(1).max(120),
    isoReference: z.string().trim().min(1).max(160),
});

const SymbologyRegisterStandardSchema = z.object({
    conceptId: z.string().trim().min(1).max(120),
    confirmWord: z.string().trim().min(1).max(32),
});

const SymbologyDrawStandardSchema = z.object({
    conceptId: z.string().trim().min(1).max(120),
    candidateIndex: z.coerce.number().int().min(0).max(20).optional().default(0),
});

const SymbologyBrandVariantSchema = z.object({
    conceptId: z.string().trim().min(1).max(120),
    brand: z.string().trim().min(1).max(120),
});

const SymbologyRegisterVariantSchema = z.object({
    conceptId: z.string().trim().min(1).max(120),
    brand: z.string().trim().min(1).max(120),
    confirmWord: z.string().trim().min(1).max(32),
});

const SymbologyUploadStandardSchema = z.object({
    conceptId: z.string().trim().min(1).max(120),
});

const SymbologySeedUniversalSchema = z.object({
    forceFullIso7010: z.coerce.boolean().optional().default(false),
});

const SymbologyPackRebuildSchema = z.object({
    globalAssetId: z.string().trim().min(1).max(160),
});

vaultRouter.get('/symbology/concepts', async (_req: ScopedRequest, res: Response) => {
    try {
        const symbols = await getMasterSymbols();
        return res.status(200).json(symbols);
    } catch (err) {
        return handleVaultError(res, err, 'Error listando conceptos de simbología.');
    }
});

vaultRouter.get('/symbology/pending', async (_req: ScopedRequest, res: Response) => {
    try {
        const pending = await getPendingSymbols();
        return res.status(200).json(pending);
    } catch (err) {
        return handleVaultError(res, err, 'Error listando símbolos pendientes.');
    }
});

vaultRouter.post('/symbology/search-iso-icon', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const parsed = SymbologySearchSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'conceptId e isoReference son requeridos.', details: parsed.error.format() });
    }

    try {
        const url = await searchIsoIconFromWikimedia(parsed.data.conceptId, parsed.data.isoReference);
        return res.status(200).json({ success: true, url, temp_standard_icon_url: url });
    } catch (err) {
        return handleVaultError(res, err, 'Error buscando pictograma ISO en Wikimedia Commons.');
    }
});

vaultRouter.post('/symbology/register-standard', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const parsed = SymbologyRegisterStandardSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'conceptId y confirmWord son requeridos.', details: parsed.error.format() });
    }
    if (!isValidHitlSymbologyWord(parsed.data.confirmWord)) {
        return res.status(400).json({
            error: 'CONFIRM_WORD_MISMATCH',
            message: `Ingrese la palabra exacta "${HITL_CONFIRM_KEYWORD}" para confirmar.`,
        });
    }

    try {
        const updated = await registerStandardIcon(parsed.data.conceptId, ctx.actorEmail, parsed.data.confirmWord);
        return res.status(200).json(updated);
    } catch (err) {
        return handleVaultError(res, err, 'Error consolidando pictograma estándar.');
    }
});

vaultRouter.post('/symbology/draw-standard', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const parsed = SymbologyDrawStandardSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'conceptId válido es requerido.', details: parsed.error.format() });
    }

    try {
        const url = await drawStandardIcon(parsed.data.conceptId, parsed.data.candidateIndex, ctx.actorEmail);
        return res.status(200).json({ success: true, temp_standard_icon_url: url });
    } catch (err) {
        return handleVaultError(res, err, 'Error vectorizando pictograma estándar.');
    }
});

vaultRouter.post('/symbology/generate-variant', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const parsed = SymbologyBrandVariantSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'conceptId y brand son requeridos.', details: parsed.error.format() });
    }

    try {
        const result = await generateBrandVariant(parsed.data.conceptId, parsed.data.brand, ctx.actorEmail);
        return res.status(200).json(result);
    } catch (err) {
        return handleVaultError(res, err, 'Error generando variante OEM.');
    }
});

vaultRouter.post('/symbology/register-variant', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const parsed = SymbologyRegisterVariantSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'conceptId, brand y confirmWord son requeridos.', details: parsed.error.format() });
    }
    if (!isValidHitlSymbologyWord(parsed.data.confirmWord)) {
        return res.status(400).json({
            error: 'CONFIRM_WORD_MISMATCH',
            message: `Ingrese la palabra exacta "${HITL_CONFIRM_KEYWORD}" para confirmar.`,
        });
    }

    try {
        const updated = await registerBrandVariant(
            parsed.data.conceptId,
            parsed.data.brand,
            ctx.actorEmail,
            parsed.data.confirmWord
        );
        return res.status(200).json(updated);
    } catch (err) {
        return handleVaultError(res, err, 'Error consolidando variante OEM.');
    }
});

vaultRouter.post(
    '/symbology/upload-manual',
    requireCurateAI,
    upload.single('file'),
    async (req: ScopedRequest, res: Response) => {
        const ctx = req.opermaqContext!;
        const parsed = SymbologyRegisterVariantSchema.safeParse(req.body);
        if (!parsed.success || !req.file) {
            return res.status(400).json({ error: 'conceptId, brand, confirmWord y archivo son requeridos.' });
        }
        if (!isValidHitlSymbologyWord(parsed.data.confirmWord)) {
            return res.status(400).json({
                error: 'CONFIRM_WORD_MISMATCH',
                message: `Ingrese la palabra exacta "${HITL_CONFIRM_KEYWORD}" para confirmar.`,
            });
        }

        try {
            const updated = await uploadManualVariant(
                parsed.data.conceptId,
                parsed.data.brand,
                req.file.buffer,
                ctx.actorEmail,
                parsed.data.confirmWord
            );
            return res.status(200).json(updated);
        } catch (err) {
            return handleVaultError(res, err, 'Error subiendo variante manual.');
        }
    }
);

vaultRouter.post(
    '/symbology/upload-standard',
    requireCurateAI,
    upload.single('file'),
    async (req: ScopedRequest, res: Response) => {
        const ctx = req.opermaqContext!;
        const parsed = SymbologyUploadStandardSchema.safeParse(req.body);
        if (!parsed.success || !req.file) {
            return res.status(400).json({ error: 'conceptId y archivo son requeridos.' });
        }

        try {
            const updated = await uploadStandardIcon(parsed.data.conceptId, req.file.buffer, ctx.actorEmail);
            return res.status(200).json(updated);
        } catch (err) {
            return handleVaultError(res, err, 'Error subiendo icono estándar.');
        }
    }
);

// ── v4.0: INGESTA SEGMENTADA DE PDFs EXTENSOS, CATÁLOGOS, ETT Y LÁMINAS OEM (EXCLUSIVO CURADORES MINREPORT) ──

vaultRouter.post(
    '/ingest-document',
    requireCurateAI,
    uploadDocument.single('file'),
    async (req: ScopedRequest, res: Response) => {
        const ctx = req.opermaqContext!;
        const file = req.file;
        const globalAssetId = String(req.body?.globalAssetId || '').trim();

        if (!file || !globalAssetId) {
            return res.status(400).json({
                error: 'Parámetros requeridos: archivo (file) y globalAssetId.',
            });
        }

        const visibilityScope =
            req.body?.visibilityScope === 'TENANT_ONLY' ? 'TENANT_ONLY' : 'COMMONS_OEM';

        const documentCategory = (
            ['OEM_MANUAL', 'CATALOG_BROCHURE', 'ETT_SPEC_SHEET', 'TECHNICAL_CHART_PHOTO'].includes(
                req.body?.documentCategory
            )
                ? req.body.documentCategory
                : undefined
        ) as
            | 'OEM_MANUAL'
            | 'CATALOG_BROCHURE'
            | 'ETT_SPEC_SHEET'
            | 'TECHNICAL_CHART_PHOTO'
            | undefined;

        const maxWindowsPerRun = req.body?.maxWindowsPerRun
            ? Math.max(1, Math.min(30, Number(req.body.maxWindowsPerRun)))
            : undefined;
        const clientOriginalBytes =
            req.body?.clientOriginalBytes && Number(req.body.clientOriginalBytes) > 0
                ? Math.round(Number(req.body.clientOriginalBytes))
                : undefined;

        try {
            const result = await withDocumentIngestSemaphore(() =>
                SegmentedDocumentProcessorService.ingestDocument({
                    globalAssetId,
                    fileBuffer: file.buffer,
                    mimeType: file.mimetype || 'application/octet-stream',
                    originalFilename: file.originalname || 'documento_oem.pdf',
                    clientOriginalBytes,
                    documentCategory,
                    visibilityScope,
                    tenantId: ctx.tenantId,
                    actorUid: ctx.actorId,
                    actorEmail: ctx.actorEmail,
                    isPrivilegedCurator: ctx.capabilities.canCurateAI,
                    maxWindowsPerRun,
                })
            );

            await AuditLedger.record({
                tenantId: ctx.tenantId,
                actorUid: ctx.actorId,
                actorEmail: ctx.actorEmail,
                action: 'OPERMAQ_MULTIMODAL_DOCUMENT_INGESTED',
                module: 'opermaq',
                targetEntity: globalAssetId,
                details: {
                    jobId: result.jobId,
                    fileSha256: result.fileSha256,
                    originalFilename: file.originalname,
                    originalBytes: result.originalBytes,
                    optimizedBytes: result.optimizedBytes,
                    savingsRatio: result.savingsRatio,
                    deduplicatedDocumentHit: result.deduplicatedDocumentHit,
                    totalPages: result.totalPages,
                    skippedUnchangedPages: result.skippedUnchangedPages,
                    extractedChaptersCount: result.extractedChaptersCount,
                    extractedFiguresCount: result.extractedFiguresCount,
                    vectorizedSymbolsCount: result.vectorizedSymbolsCount,
                },
            });

            return res.status(200).json({ success: true, ...result });
        } catch (err) {
            return handleVaultError(res, err, 'Error procesando documento técnico OEM.');
        }
    }
);

vaultRouter.get('/corpus/:globalAssetId', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const globalAssetId = String(req.params.globalAssetId || '').trim();
    if (!globalAssetId) return res.status(400).json({ error: 'globalAssetId requerido.' });

    try {
        const assetRef = db.collection('global_asset_catalog').doc(globalAssetId);
        const [filesSnap, jobsSnap] = await Promise.all([
            assetRef.collection('vault_files').limit(40).get(),
            assetRef.collection('ingestion_jobs').limit(25).get(),
        ]);

        const files = filesSnap.docs
            .map((d) => d.data())
            .sort((a: any, b: any) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        const jobs = jobsSnap.docs
            .map((d) => d.data())
            .sort((a: any, b: any) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));

        return res.status(200).json({ files, jobs });
    } catch (err) {
        return handleVaultError(res, err, 'Error consultando corpus técnico del activo.');
    }
});

// ── PROYECCIÓN SEGURA DE LOS 5 PILARES PUBLICADOS (`APROBADO_HUMANO`) Y CUARENTENA DOCUMENTAL CLIENTES ──

/**
 * GET /api/vault/published/:globalAssetId
 * Proyecta únicamente la información técnica autorizada para publicación por un humano de MINREPORT
 * (`estado_aprobacion === 'APROBADO_HUMANO'`), ocultando borradores crudos de IA y metadatos internos.
 */
vaultRouter.get('/published/:globalAssetId', async (req: ScopedRequest, res: Response) => {
    const globalAssetId = String(req.params.globalAssetId || '').trim();
    if (!globalAssetId) return res.status(400).json({ error: 'globalAssetId requerido.' });

    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(globalAssetId);
        if (!hydrated.exists || !hydrated.data) {
            return res.status(404).json({ error: 'Ficha de catálogo no encontrada.' });
        }

        const data = hydrated.data;
        const rawVault = data.knowledge_vault || {};
        const publishedPillars: Record<
            PillarId,
            {
                pillar_id: PillarId;
                published_count: number;
                items: Array<{
                    item_id: string;
                    order: number;
                    title: string;
                    section: string;
                    priority: string;
                    content: string;
                    figures: any[];
                    symbology_refs: string[];
                    approved_at: string | null;
                }>;
            }
        > = {} as any;

        for (const pid of VALID_PILLAR_IDS) {
            const pDoc = rawVault?.[pid];
            const rawItems: any[] = Array.isArray(pDoc?.items) ? pDoc.items : [];
            const approvedItems = rawItems
                .filter(
                    (it) =>
                        !it?.is_discarded &&
                        it?.content_status === 'COMPLETADO' &&
                        it?.estado_aprobacion === 'APROBADO_HUMANO' &&
                        Boolean(String(it?.content || '').trim())
                )
                .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
                .map((it, idx) => ({
                    item_id: String(it.item_id || `${pid}_${idx + 1}`),
                    order: idx + 1,
                    title: String(it.title || 'Capítulo Técnico'),
                    section: String(it.section || 'INGENIERÍA PUBLICADA'),
                    priority: String(it.priority || 'IMPORTANTE'),
                    content: String(it.content || ''),
                    figures: Array.isArray(it.figures) ? it.figures : [],
                    symbology_refs: Array.isArray(it.symbology_refs) ? it.symbology_refs : [],
                    approved_at: it.approved_at ? String(it.approved_at) : null,
                }));

            publishedPillars[pid] = {
                pillar_id: pid,
                published_count: approvedItems.length,
                items: approvedItems,
            };
        }

        return res.status(200).json({
            id: hydrated.id,
            make_oficial: String(data.make_oficial || data.make || ''),
            model_oficial: String(data.model_oficial || data.model || ''),
            make_model: String(
                data.make_model || `${data.make_oficial || data.make || ''} ${data.model_oficial || data.model || ''}`
            ).trim(),
            tipo_equipo: String(data.tipo_equipo || '[Información técnica no declarada en ficha]'),
            categoria_equipo: String(data.categoria_equipo || ''),
            ambiente_operativo: Array.isArray(data.ambiente_operativo) ? data.ambiente_operativo : [],
            contexto_operativo: Array.isArray(data.contexto_operativo) ? data.contexto_operativo : [],
            caracteristicas_principales: Array.isArray(data.caracteristicas_principales)
                ? data.caracteristicas_principales
                : [],
            foto_url: data.foto_url || null,
            official_url: data.official_url || '',
            is_sealed: Boolean(data.is_sealed || data.isSealed || rawVault?.is_sealed),
            published_pillars: publishedPillars,
        });
    } catch (err) {
        return handleVaultError(res, err, 'Error consultando proyección publicada de los 5 pilares.');
    }
});

/**
 * POST /api/vault/client-contribute-pdf
 * Subida segura de PDF desde Control de Flota (Clientes B2B / EDU):
 * Evalúa el contenido por IA + deduplicación de triple capa y lo envía a cuarentena humana
 * (`knowledge_contributions` -> `PENDING_HUMAN_REVIEW`) sin publicar automáticamente.
 */
vaultRouter.post(
    '/client-contribute-pdf',
    uploadDocument.single('file'),
    async (req: ScopedRequest, res: Response) => {
        const ctx = req.opermaqContext!;
        if (ctx.isEduSandbox) {
            return res.status(403).json({
                error: 'EDU_SANDBOX_ISOLATED',
                message: 'El entorno académico EDU opera en sandbox aislado y no envía aportes al repositorio productivo.',
            });
        }
        if (!ctx.capabilities.canManageFleet && !ctx.capabilities.canCurateAI) {
            return res.status(403).json({
                error: 'FORBIDDEN',
                message: 'Permisos insuficientes para enviar documentación técnica desde flota.',
            });
        }

        const file = req.file;
        const globalAssetId = String(req.body?.globalAssetId || '').trim();
        const tenantAssetId = req.body?.tenantAssetId ? String(req.body.tenantAssetId).trim() : undefined;

        if (!file || !globalAssetId) {
            return res.status(400).json({
                error: 'Adjunte un archivo PDF válido e indique el equipo destino (`globalAssetId`).',
            });
        }

        try {
            const clientOriginalBytes =
                req.body?.clientOriginalBytes && Number(req.body.clientOriginalBytes) > 0
                    ? Math.round(Number(req.body.clientOriginalBytes))
                    : undefined;
            const result = await withDocumentIngestSemaphore(() =>
                SegmentedDocumentProcessorService.ingestClientPdfToQuarantine({
                    globalAssetId,
                    tenantAssetId,
                    fileBuffer: file.buffer,
                    mimeType: file.mimetype || 'application/pdf',
                    originalFilename: file.originalname || 'aporte_tecnico.pdf',
                    clientOriginalBytes,
                    tenantId: ctx.tenantId,
                    actorUid: ctx.actorId,
                    actorEmail: ctx.actorEmail,
                })
            );

            await AuditLedger.record({
                tenantId: ctx.tenantId,
                actorUid: ctx.actorId,
                actorEmail: ctx.actorEmail,
                action: 'OPERMAQ_CLIENT_PDF_QUARANTINED',
                module: 'opermaq',
                targetEntity: globalAssetId,
                details: {
                    contributionId: result.contributionId,
                    quarantineStatus: result.quarantineStatus,
                    fileSha256: result.fileSha256,
                    totalPages: result.totalPages,
                    skippedUnchangedPages: result.skippedUnchangedPages,
                    skippedSemanticDuplicates: result.skippedSemanticDuplicates,
                    netNewItemsCount: result.netNewItemsCount,
                },
            }).catch(() => {});

            return res.status(200).json({ success: true, ...result });
        } catch (err) {
            return handleVaultError(res, err, 'Error evaluando PDF para revisión humana MINREPORT.');
        }
    }
);

/**
 * GET /api/vault/my-contributions/:globalAssetId
 * Retorna exclusivamente el estado de los PDFs enviados por el propio tenant activo sobre ese modelo.
 */
vaultRouter.get('/my-contributions/:globalAssetId', async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const globalAssetId = String(req.params.globalAssetId || '').trim();
    if (!globalAssetId || !ctx.tenantId) {
        return res.status(200).json({ items: [] });
    }

    try {
        const snap = await db
            .collection('knowledge_contributions')
            .where('tenantId', '==', ctx.tenantId)
            .limit(40)
            .get();

        const items = snap.docs
            .map((d): Record<string, any> => ({ id: d.id, ...(d.data() || {}) }))
            .filter((d) => d.global_asset_id === globalAssetId)
            .map((d) => ({
                id: d.id,
                sanitized_filename: d.sanitized_filename || 'Documento PDF',
                status: d.status || 'PENDING_HUMAN_REVIEW',
                dedup_metrics: d.dedup_metrics || {},
                created_at: d.created_at || '',
                reviewed_at: d.reviewed_at || null,
            }))
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

        return res.status(200).json({ items });
    } catch (err) {
        return handleVaultError(res, err, 'Error consultando estado de aportes documentales.');
    }
});

/**
 * GET /api/vault/contributions
 * Bandeja exclusiva de humanos acreditados en MINREPORT (`DEV` / `SUPER_ADMIN` / `TEST-PILOT`)
 * para revisar aportes PDF en cuarentena sin exponer razones sociales entre clientes.
 */
vaultRouter.get('/contributions', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const filterAssetId = String(req.query.globalAssetId || '').trim();
    const filterStatus = String(req.query.status || '').trim();

    try {
        let q: FirebaseFirestore.Query = db.collection('knowledge_contributions');
        if (filterAssetId) {
            q = q.where('global_asset_id', '==', filterAssetId);
        }
        const snap = await q.limit(100).get();

        const items = snap.docs
            .map((d) => {
                const raw = d.data();
                return {
                    id: d.id,
                    global_asset_id: raw.global_asset_id || '',
                    make_model: raw.make_model || '',
                    sanitized_filename: raw.sanitized_filename || 'Aporte PDF',
                    file_sha256: raw.file_sha256 || '',
                    status: raw.status || 'PENDING_HUMAN_REVIEW',
                    estado_aprobacion: raw.estado_aprobacion || 'BORRADOR_IA',
                    proposed_items: Array.isArray(raw.proposed_items) ? raw.proposed_items : [],
                    dedup_metrics: raw.dedup_metrics || {},
                    review_notes: raw.review_notes || '',
                    reviewed_by_email: raw.reviewed_by_email || null,
                    reviewed_at: raw.reviewed_at || null,
                    created_at: raw.created_at || '',
                };
            })
            .filter((item) => (!filterStatus ? true : item.status === filterStatus))
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

        return res.status(200).json({ items });
    } catch (err) {
        return handleVaultError(res, err, 'Error listando bandeja de cuarentena documental HITL.');
    }
});

/**
 * POST /api/vault/contributions/:contributionId/review
 * Autorización humana granular 1 a 1 (`[Actual] ➔ [Sugerido]`) + palabra obligatoria `"ACTUALIZAR"`.
 */
vaultRouter.post(
    '/contributions/:contributionId/review',
    requireCurateAI,
    async (req: ScopedRequest, res: Response) => {
        const ctx = req.opermaqContext!;
        const contributionId = String(req.params.contributionId || '').trim();
        const parsed = ReviewContributionBodySchema.safeParse(req.body || {});
        if (!parsed.success || !contributionId) {
            return res.status(400).json({
                error: 'Parámetros de revisión HITL inválidos.',
                details: parsed.success ? undefined : parsed.error.format(),
            });
        }

        if (parsed.data.confirmWord.trim().toUpperCase() !== HITL_CONFIRM_KEYWORD) {
            return res.status(400).json({
                error: `Confirmación obligatoria inválida. Escriba "${HITL_CONFIRM_KEYWORD}" para consolidar.`,
            });
        }

        try {
            const outcome = await SegmentedDocumentProcessorService.consolidateHumanReviewedContribution({
                contributionId,
                acceptedProposalIds: parsed.data.acceptedProposalIds,
                rejectedProposalIds: parsed.data.rejectedProposalIds,
                publishApprovedItems: parsed.data.publishApprovedItems,
                reviewNotes: parsed.data.reviewNotes,
                reviewerUid: ctx.actorId,
                reviewerEmail: ctx.actorEmail,
            });

            await AuditLedger.record({
                tenantId: ctx.tenantId,
                actorUid: ctx.actorId,
                actorEmail: ctx.actorEmail,
                action: 'OPERMAQ_CONTRIBUTION_HITL_REVIEWED',
                module: 'opermaq',
                targetEntity: outcome.globalAssetId,
                details: {
                    contributionId,
                    status: outcome.status,
                    consolidatedCount: outcome.consolidatedCount,
                    rejectedCount: outcome.rejectedCount,
                    publishedImmediately: parsed.data.publishApprovedItems,
                },
            }).catch(() => {});

            return res.status(200).json({ success: true, ...outcome });
        } catch (err) {
            return handleVaultError(res, err, 'Error consolidando revisión humana de aporte documental.');
        }
    }
);

vaultRouter.post('/acknowledge-locked-advisory', async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    if (!ctx.capabilities.canCurateAI) {
        return res.status(403).json({ error: 'Permisos insuficientes para gestionar avisos HITL.' });
    }

    const schema = z.object({
        globalAssetId: z.string().min(1),
        pillarId: z.string().min(1),
        itemId: z.string().min(1),
        advisoryId: z.string().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Parámetros inválidos.' });

    const { globalAssetId, pillarId, itemId, advisoryId } = parsed.data;
    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(globalAssetId);
        if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Catálogo no encontrado.' });

        const pillar = hydrated.data.knowledge_vault?.[pillarId];
        if (!pillar) return res.status(404).json({ error: 'Pilar no encontrado.' });
        const items = [...(pillar.items || [])];
        const idx = items.findIndex((it: any) => it.item_id === itemId);
        if (idx === -1) return res.status(404).json({ error: 'Ítem no encontrado.' });

        const advisories = [...(items[idx].locked_item_advisories || [])].map((adv: any) =>
            adv.advisory_id === advisoryId
                ? {
                      ...adv,
                      acknowledged: true,
                      acknowledged_by: ctx.actorEmail,
                      acknowledged_at: new Date().toISOString(),
                  }
                : adv
        );

        items[idx] = { ...items[idx], locked_item_advisories: advisories };
        await VaultPersistenceService.savePillarDocument({
            globalAssetId,
            pillarId: pillarId as PillarId,
            pillarDoc: {
                ...pillar,
                pillar_id: pillarId as PillarId,
                items,
                updated_at: new Date().toISOString(),
            },
        });
        void AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'opermaq',
            action: 'VAULT_LOCKED_ADVISORY_ACKNOWLEDGED',
            targetEntity: `global_asset_catalog/${globalAssetId}/pillars/${pillarId}/${itemId}`,
            details: { pillarId, itemId, advisoryId },
        }).catch(() => undefined);
        return res.status(200).json({ success: true });
    } catch (err) {
        return handleVaultError(res, err, 'Error confirmando aviso sobre ítem bloqueado.');
    }
});

// ── v3.0: PAQUETE AD-HOC DE SIMBOLOGÍA VECTORIAL + MANUALES AD-HOC + FEEDBACK TEST-PILOT ──

vaultRouter.get('/symbology-pack/:globalAssetId', async (req: ScopedRequest, res: Response) => {
    const globalAssetId = String(req.params.globalAssetId || '').trim();
    try {
        const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(globalAssetId);
        if (!hydrated.exists || !hydrated.data) return res.status(404).json({ error: 'Activo no encontrado.' });

        const data = hydrated.data;
        const pack =
            data.symbology_pack && data.symbology_pack.total_symbols > 0
                ? data.symbology_pack
                : await buildAndPersistAssetSymbologyPack(globalAssetId, data);

        return res.status(200).json(pack);
    } catch (err) {
        return handleVaultError(res, err, 'Error obteniendo paquete ad-hoc de simbología.');
    }
});

vaultRouter.post('/symbology-pack/rebuild', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const parsed = SymbologyPackRebuildSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'globalAssetId requerido.', details: parsed.error.format() });

    try {
        const pack = await buildAndPersistAssetSymbologyPack(parsed.data.globalAssetId);
        return res.status(200).json({ success: true, pack });
    } catch (err) {
        return handleVaultError(res, err, 'Error reconstruyendo paquete de simbología.');
    }
});

vaultRouter.post('/symbology/seed-universal', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const parsed = SymbologySeedUniversalSchema.safeParse(req.body || {});
    const fullIso7010 = parsed.success ? parsed.data.forceFullIso7010 : false;
    try {
        const result = await ensureUniversalSymbologySeeded(fullIso7010);
        return res.status(200).json({ success: true, ...result });
    } catch (err) {
        return handleVaultError(res, err, 'Error sembrando catálogo vectorial universal.');
    }
});

const VaultPilotFeedbackSchema = z.object({
    globalAssetId: z.string().trim().min(1).max(160),
    pillarId: z
        .enum([
            'ficha_tecnica',
            'manual_operaciones',
            'pauta_mantencion',
            'matriz_riesgos',
            'checklist_pre_op',
        ])
        .optional(),
    itemId: z.string().trim().max(120).optional(),
    category: z
        .enum(['AI_KNOWLEDGE_TRAINING', 'CHANGE_REQUEST', 'BUG_CORRECTION', 'FIELD_SIMULATION'])
        .default('AI_KNOWLEDGE_TRAINING'),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
    observation: z.string().trim().min(3).max(4000),
    expectedAiBehavior: z.string().trim().max(2000).optional(),
    proposedContent: z.string().max(32000).optional(),
});

vaultRouter.post('/pilot-feedback', requireCurateAI, async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const parsed = VaultPilotFeedbackSchema.safeParse(req.body || {});
    if (!parsed.success) {
        return res.status(400).json({
            error: parsed.error.issues[0]?.message || 'Parámetros de feedback TEST-PILOT inválidos.',
            details: parsed.error.format(),
        });
    }

    try {
        const d = parsed.data;
        const cleanObs = ConfidentialityAirlockService.scrubDeterministicPii(d.observation).scrubbed.trim();
        const cleanExpected = d.expectedAiBehavior
            ? ConfidentialityAirlockService.scrubDeterministicPii(d.expectedAiBehavior).scrubbed.trim()
            : null;
        const cleanProposed = d.proposedContent
            ? ConfidentialityAirlockService.scrubDeterministicPii(d.proposedContent).scrubbed.trim()
            : null;

        const feedbackRef = db.collection('pilot_feedback').doc();
        const nowIso = new Date().toISOString();
        const record = {
            id: feedbackRef.id,
            feedbackId: feedbackRef.id,
            tenantId: ctx.tenantId || 'dev-master-sandbox',
            authorUid: ctx.actorId,
            authorEmail: ctx.actorEmail,
            authorRole:
                ctx.accountTier === 1
                    ? 'DEV_ROOT'
                    : ctx.accountTier === 2
                    ? 'SUPER_ADMIN'
                    : ctx.isTestPilot
                    ? 'TEST_PILOT'
                    : 'CURATOR',
            module: 'opermaq' as const,
            executionMode: 'integrated' as const,
            category: d.category,
            priority: d.priority,
            contextPath: `/opermaq/vault/${d.globalAssetId}${d.pillarId ? `/${d.pillarId}` : ''}${d.itemId ? `/${d.itemId}` : ''}`,
            assetOrSurveyId: d.globalAssetId,
            pillarId: d.pillarId || null,
            itemId: d.itemId || null,
            observation: cleanObs,
            expectedAiBehavior: cleanExpected,
            status: 'OPEN' as const,
            timestamp: nowIso,
            createdAt: Date.now(),
        };

        await feedbackRef.set(record);

        let hitlCandidateId: string | null = null;
        if (d.category === 'AI_KNOWLEDGE_TRAINING' || cleanProposed) {
            const candRef = db.collection('hitl_candidates').doc();
            hitlCandidateId = candRef.id;
            await candRef.set({
                id: candRef.id,
                feedbackId: feedbackRef.id,
                module: 'opermaq',
                globalAssetId: d.globalAssetId,
                pillarId: d.pillarId || null,
                itemId: d.itemId || null,
                authorUid: ctx.actorId,
                authorEmail: ctx.actorEmail,
                observation: cleanObs,
                expectedAiBehavior: cleanExpected,
                proposedContent: cleanProposed,
                status: 'PENDING_REVIEW',
                createdAt: nowIso,
            });
        }

        await AuditLedger.record({
            tenantId: ctx.tenantId || 'GLOBAL_OEM',
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
            module: 'test-pilot',
            action: `OPERMAQ_PILOT_FEEDBACK_${d.category}`,
            targetEntity: feedbackRef.id,
            details: {
                globalAssetId: d.globalAssetId,
                pillarId: d.pillarId || null,
                itemId: d.itemId || null,
                hitlCandidateId,
                priority: d.priority,
            },
        }).catch(() => undefined);

        return res.status(201).json({
            success: true,
            feedbackId: feedbackRef.id,
            hitlCandidateId,
            item: record,
        });
    } catch (err) {
        return handleVaultError(res, err, 'Error registrando retroalimentación TEST-PILOT.');
    }
});

vaultRouter.post('/compile-manual', async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    const schema = z.object({
        globalAssetId: z.string().min(1),
        profileId: z.enum([
            'MASTER_5_PILLARS',
            'OPERATOR_POCKET_GUIDE',
            'WORKSHOP_PM_MANUAL',
            'REGULATORY_DS132_LOTO',
        ]),
        tenantAssetId: z.string().optional(),
        includeTenantOverrides: z.boolean().optional().default(false),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Parámetros inválidos.', details: parsed.error.format() });
    }

    try {
        const compiled = await OpermaqManualPublisher.compileAdHocManual({
            globalAssetId: parsed.data.globalAssetId,
            profileId: parsed.data.profileId as AdHocManualProfileId,
            tenantAssetId: parsed.data.tenantAssetId,
            includeTenantOverrides: parsed.data.includeTenantOverrides,
            tenantId: ctx.tenantId,
            actorUid: ctx.actorId,
            actorEmail: ctx.actorEmail,
        });

        return res.status(200).json({ success: true, ...compiled });
    } catch (err) {
        return handleVaultError(res, err, 'Error compilando manual ad-hoc ilustrado.');
    }
});

vaultRouter.get('/manuals/:globalAssetId', async (req: ScopedRequest, res: Response) => {
    const globalAssetId = String(req.params.globalAssetId || '').trim();
    try {
        const snap = await db
            .collection('global_asset_catalog')
            .doc(globalAssetId)
            .collection('generated_manuals')
            .limit(20)
            .get();

        const manuals = snap.docs
            .map((d) => d.data())
            .sort((a: any, b: any) => String(b.compiledAt || '').localeCompare(String(a.compiledAt || '')));

        return res.status(200).json({ manuals });
    } catch (err) {
        return handleVaultError(res, err, 'Error listando manuales ad-hoc generados.');
    }
});

// ── v4.0: INTELIGENCIA COLECTIVA (k >= 5)-ANÓNIMA + CATÁLOGO MATERIALES STOCKPILE ──

vaultRouter.post('/benchmarks/record', async (req: ScopedRequest, res: Response) => {
    const ctx = req.opermaqContext!;
    if (ctx.isEduSandbox) {
        return res.status(403).json({
            error: 'EDU_SANDBOX_ISOLATED',
            message: 'El entorno académico EDU opera en sandbox aislado y no contamina benchmarks productivos.',
        });
    }
    const schema = z.object({
        module: z.enum(['opermaq', 'stockpile']),
        targetCanonicalId: z.string().min(1),
        metricKind: z.enum([
            'FUEL_CONSUMPTION_LH',
            'HYDRAULIC_FILTER_LIFE_H',
            'TIRE_OR_TRACK_LIFE_H',
            'PM_AVAILABILITY_PCT',
            'MATERIAL_BULK_DENSITY_TM3',
        ]),
        numericValue: z.number().positive(),
        unitSi: z.string().min(1),
        operatingContextTag: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Parámetros inválidos.' });

    try {
        const recorded = await CollectiveBenchmarkService.recordAnonymousMetricEvent({
            tenantId: ctx.tenantId,
            module: parsed.data.module,
            targetCanonicalId: parsed.data.targetCanonicalId,
            metricKind: parsed.data.metricKind as BenchmarkMetricKind,
            numericValue: parsed.data.numericValue,
            unitSi: parsed.data.unitSi,
            operatingContextTag: parsed.data.operatingContextTag,
        });
        return res.status(200).json({ success: true, ...recorded });
    } catch (err) {
        return handleVaultError(res, err, 'Error registrando telemetría anónima.');
    }
});

vaultRouter.get('/benchmarks/:targetCanonicalId/:metricKind', async (req: ScopedRequest, res: Response) => {
    try {
        const summary = await CollectiveBenchmarkService.getAnonymousBenchmarkSummary(
            String(req.params.targetCanonicalId),
            String(req.params.metricKind) as BenchmarkMetricKind
        );
        return res.status(200).json(summary);
    } catch (err) {
        return handleVaultError(res, err, 'Error consultando benchmark k-anónimo.');
    }
});

vaultRouter.get('/materials-catalog', async (_req: ScopedRequest, res: Response) => {
    try {
        const materials = await CollectiveBenchmarkService.listGlobalMaterialsCatalog();
        return res.status(200).json({ materials });
    } catch (err) {
        return handleVaultError(res, err, 'Error listando catálogo universal de materiales.');
    }
});

export default vaultRouter;
