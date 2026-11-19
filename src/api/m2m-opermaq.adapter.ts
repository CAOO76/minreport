import type express from 'express';
import { z } from 'zod';
import { db } from '../config/firebase';
import { x402Gatekeeper, type X402AuthenticatedRequest } from '../middleware/x402Gatekeeper';
import { AssetOntologyEngine } from '../modules/opermaq/services/AssetOntologyEngine';
import {
    compileEquipmentCostMatrixFromPillars,
    computeCostMatrixSourceDigest,
    COST_MATRIX_SCHEMA_VERSION,
} from '../modules/opermaq/services/EquipmentCostMatrixCompiler';
import {
    GLOBAL_EQUIPMENT_TYPES_COLLECTION,
    listRegisteredEquipmentTypes,
    normalizeEquipmentTypeAlias,
    normalizeEquipmentTypeKey,
    upgradeEquipmentTypeSchemaIfNeeded,
} from '../modules/opermaq/services/EquipmentTypeRegistryService';
import {
    computePillarStructureDigestSha256,
    computeVaultMerkleRootSha256,
} from '../modules/opermaq/services/ItemizerService';
import { VaultPersistenceService } from '../modules/opermaq/services/VaultPersistenceService';
import {
    type GlobalEquipmentTypeDoc,
    PILLAR_PREREQUISITE_MAP,
    type PillarDocument,
    type PillarId,
} from '../modules/opermaq/types/vault.types';
import {
    normalizeCanonicalSlotsByResolvedEnergy,
    normalizeLegacySpecLinesByEnergy,
    sanitizeDesignAndWorkContextItems,
} from '../modules/opermaq/utils/canonicalArchetypeSpecs';

/**
 * ADAPTADOR M2M x402 DESACOPLADO PARA OPERMAQ
 *
 * Aísla las rutas M2M (`/api/m2m/opermaq/*`) fuera del núcleo `src/index.ts`,
 * evitando acoplar el arranque HTTP principal a servicios internos de dominio OPERMAQ.
 */

export const M2mAssetIdParamSchema = z.object({
    assetId: z.string().trim().min(1).max(128),
});

export const M2mOntologyTypeKeyParamSchema = z.object({
    typeKey: z.string().trim().min(2).max(96),
});

function normalizeSidebarProfileLists(data: Record<string, any>): {
    canonical_specs: any[];
    caracteristicas_principales: string[];
    ambiente_operativo: string[];
    contexto_operativo: string[];
} {
    const typeContextText = `${data.make_model || ''} ${data.tipo_equipo || ''} ${data.categoria_equipo || ''}`.trim();
    const primaryEnergy = data.physical_traits?.primary_energy || null;
    const energyValueText =
        data.energy_consumption_profile?.energy_spec_label ||
        (data.energy_consumption_profile?.energy_source &&
        data.energy_consumption_profile.energy_source !== 'NO_DECLARADO'
            ? data.energy_consumption_profile.energy_source
            : null);

    const canonicalSpecs = Array.isArray(data.canonical_specs)
        ? normalizeCanonicalSlotsByResolvedEnergy(data.canonical_specs, {
              typeContextText,
              primaryEnergy,
              energyValueText,
          })
        : [];

    const caracteristicasPrincipales = Array.isArray(data.caracteristicas_principales)
        ? normalizeLegacySpecLinesByEnergy(data.caracteristicas_principales, {
              typeContextText,
              primaryEnergy,
              energyValueText,
          })
        : [];

    const ambienteOperativo = Array.isArray(data.ambiente_operativo)
        ? sanitizeDesignAndWorkContextItems(data.ambiente_operativo, undefined, {
              canonicalTypeEs: data.tipo_equipo || null,
          })
        : [];

    const contextoOperativo = Array.isArray(data.contexto_operativo)
        ? sanitizeDesignAndWorkContextItems(data.contexto_operativo, undefined, {
              canonicalTypeEs: data.tipo_equipo || null,
          })
        : [];

    return {
        canonical_specs: canonicalSpecs,
        caracteristicas_principales: caracteristicasPrincipales,
        ambiente_operativo: ambienteOperativo,
        contexto_operativo: contextoOperativo,
    };
}

async function resolveReadOnlyEquipmentTypeOntology(rawTypeKey: string): Promise<GlobalEquipmentTypeDoc | null> {
    const normalizedKey = normalizeEquipmentTypeKey(rawTypeKey);
    const normalizedAlias = normalizeEquipmentTypeAlias(rawTypeKey.replace(/_/g, ' '));

    if (normalizedKey) {
        const directSnap = await db.collection(GLOBAL_EQUIPMENT_TYPES_COLLECTION).doc(normalizedKey).get();
        if (directSnap.exists) {
            const existing = directSnap.data() as GlobalEquipmentTypeDoc;
            if (Array.isArray(existing?.spec_schema) && existing.spec_schema.length >= 2) {
                return upgradeEquipmentTypeSchemaIfNeeded(existing).doc;
            }
        }
    }

    if (rawTypeKey !== normalizedKey) {
        const rawSnap = await db.collection(GLOBAL_EQUIPMENT_TYPES_COLLECTION).doc(rawTypeKey).get();
        if (rawSnap.exists) {
            const existing = rawSnap.data() as GlobalEquipmentTypeDoc;
            if (Array.isArray(existing?.spec_schema) && existing.spec_schema.length >= 2) {
                return upgradeEquipmentTypeSchemaIfNeeded(existing).doc;
            }
        }
    }

    if (normalizedAlias.length >= 2) {
        const aliasSnap = await db
            .collection(GLOBAL_EQUIPMENT_TYPES_COLLECTION)
            .where('type_aliases', 'array-contains', normalizedAlias)
            .limit(1)
            .get();
        if (!aliasSnap.empty) {
            const existing = aliasSnap.docs[0].data() as GlobalEquipmentTypeDoc;
            if (Array.isArray(existing?.spec_schema) && existing.spec_schema.length >= 2) {
                return upgradeEquipmentTypeSchemaIfNeeded(existing).doc;
            }
        }
    }

    const registeredAndSeeded = await listRegisteredEquipmentTypes();
    const staticHit = registeredAndSeeded.find((candidate) => {
        if (candidate.type_key === normalizedKey || candidate.type_key === rawTypeKey) {
            return true;
        }
        if (normalizeEquipmentTypeAlias(candidate.canonical_type_es) === normalizedAlias) {
            return true;
        }
        return (
            Array.isArray(candidate.type_aliases) &&
            candidate.type_aliases.some((alias) => normalizeEquipmentTypeAlias(alias) === normalizedAlias)
        );
    });

    return staticHit ? upgradeEquipmentTypeSchemaIfNeeded(staticHit).doc : null;
}

export function registerM2mOpermaqAdapterRoutes(app: express.Application): void {
    app.get(
        '/api/m2m/opermaq/vault-blueprint/:assetId',
        x402Gatekeeper({ priceMicroUSD: 35000, resourceId: 'opermaq-vault-merkle-blueprint' }),
        async (req: X402AuthenticatedRequest, res) => {
            try {
                const x402Ctx = req.x402Context;
                const parsedParams = M2mAssetIdParamSchema.safeParse(req.params || {});
                if (!parsedParams.success) {
                    return res.status(400).json({ error: 'Identificador de activo requerido.' });
                }
                const { assetId } = parsedParams.data;

                const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(assetId);
                if (!hydrated.exists || !hydrated.data) {
                    return res.status(404).json({ error: 'Activo no encontrado en bóveda soberana OPERMAQ.' });
                }

                const data = hydrated.data;
                const vault = (data.knowledge_vault || {}) as Record<string, any>;
                const orderedPillars: PillarId[] = [
                    'ficha_tecnica',
                    'manual_operaciones',
                    'pauta_mantencion',
                    'matriz_riesgos',
                    'checklist_pre_op',
                ];

                const pillarsBlueprint: Record<string, any> = {};
                let isMerkleChainIntact = true;

                for (const pId of orderedPillars) {
                    const pDoc = vault[pId];
                    const activeItems = Array.isArray(pDoc?.items)
                        ? pDoc.items
                              .filter((it: any) => !it?.is_discarded)
                              .map((it: any, idx: number) => ({
                                  item_id: it.item_id,
                                  order_index: typeof it.order === 'number' ? it.order : idx + 1,
                                  section: it.section,
                                  title: it.title,
                                  criticality: it.priority || 'IMPORTANTE',
                                  content_status: it.content_status,
                                  estado_aprobacion: it.estado_aprobacion,
                              }))
                        : [];

                    const computedDigest =
                        activeItems.length > 0 ? computePillarStructureDigestSha256(pDoc.items) : null;
                    const storedDigest = pDoc?.structure_digest_sha256 || computedDigest;

                    const prereqId = PILLAR_PREREQUISITE_MAP[pId];
                    const expectedParentDigest = prereqId
                        ? pillarsBlueprint[prereqId]?.structure_digest_sha256 ?? null
                        : null;
                    const storedParentDigest = pDoc?.parent_pillar_digest_sha256 ?? null;

                    const isSynchronizedWithParent =
                        !prereqId ||
                        !storedParentDigest ||
                        !expectedParentDigest ||
                        storedParentDigest === expectedParentDigest;

                    if (!isSynchronizedWithParent) {
                        isMerkleChainIntact = false;
                    }

                    pillarsBlueprint[pId] = {
                        itemize_status: pDoc?.itemize_status || 'IDLE',
                        active_items_count: activeItems.length,
                        structure_digest_sha256: storedDigest,
                        parent_pillar_digest_sha256: storedParentDigest,
                        is_synchronized_with_parent: isSynchronizedWithParent,
                        chapters: activeItems,
                    };
                }

                const vaultMerkleRootSha256 =
                    vault.vault_merkle_root_sha256 || computeVaultMerkleRootSha256(vault);

                return res.status(200).json({
                    success: true,
                    protocol: 'x402 Foundation v1.0',
                    region: 'southamerica-west1',
                    timestamp: new Date().toISOString(),
                    settlementMode: x402Ctx?.mode || 'VERIFIED',
                    blueprint: {
                        assetId: hydrated.id,
                        make: data.make_oficial || data.make || 'GENÉRICO',
                        model: data.model_oficial || data.model || '',
                        categoria_equipo: data.categoria_equipo || null,
                        tipo_equipo: data.tipo_equipo || null,
                        physical_traits: data.physical_traits || null,
                        is_sealed: Boolean(data.is_sealed),
                        vault_merkle_root_sha256: vaultMerkleRootSha256,
                        is_merkle_chain_intact: isMerkleChainIntact,
                        canonical_specs: data.canonical_specs || {},
                        energy_consumption_profile: data.energy_consumption_profile || null,
                        pillars: pillarsBlueprint,
                    },
                });
            } catch (err: any) {
                console.error('[M2M-VAULT-BLUEPRINT] Error exportando blueprint criptográfico:', err);
                return res
                    .status(500)
                    .json({ error: 'Error consultando blueprint criptográfico de bóveda OPERMAQ.' });
            }
        }
    );

    app.get(
        '/api/m2m/opermaq/vault/:assetId/specs',
        x402Gatekeeper({ priceMicroUSD: 20000, resourceId: 'opermaq-vault-canonical-specs' }),
        async (req: X402AuthenticatedRequest, res) => {
            try {
                const x402Ctx = req.x402Context;
                const parsedParams = M2mAssetIdParamSchema.safeParse(req.params || {});
                if (!parsedParams.success) {
                    return res.status(400).json({ error: 'Identificador de activo requerido.' });
                }
                const { assetId } = parsedParams.data;

                const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(assetId);
                if (!hydrated.exists || !hydrated.data) {
                    return res.status(404).json({ error: 'Activo no encontrado en bóveda soberana OPERMAQ.' });
                }

                const data = hydrated.data;
                const vault = (data.knowledge_vault || {}) as Record<string, any>;
                const vaultMerkleRootSha256 =
                    computeVaultMerkleRootSha256(vault) || vault.vault_merkle_root_sha256 || null;
                const normalizedLists = normalizeSidebarProfileLists(data);

                return res.status(200).json({
                    success: true,
                    protocol: 'x402 Foundation v1.0',
                    region: 'southamerica-west1',
                    timestamp: new Date().toISOString(),
                    settlementMode: x402Ctx?.mode || 'VERIFIED',
                    asset: {
                        assetId: hydrated.id,
                        make: data.make_oficial || data.make || 'GENÉRICO',
                        model: data.model_oficial || data.model || '',
                        categoria_equipo: data.categoria_equipo || null,
                        tipo_equipo: data.tipo_equipo || null,
                        is_sealed: Boolean(data.is_sealed),
                        vault_merkle_root_sha256: vaultMerkleRootSha256,
                        canonical_specs: normalizedLists.canonical_specs,
                        caracteristicas_principales: normalizedLists.caracteristicas_principales,
                        ambiente_operativo: normalizedLists.ambiente_operativo,
                        contexto_operativo: normalizedLists.contexto_operativo,
                        energy_consumption_profile: data.energy_consumption_profile || null,
                        physical_traits: data.physical_traits || null,
                    },
                });
            } catch (err: any) {
                console.error('[M2M-VAULT-SPECS] Error exportando especificaciones canónicas M2M:', err);
                return res.status(500).json({ error: 'Error consultando especificaciones canónicas M2M.' });
            }
        }
    );

    app.get(
        '/api/m2m/opermaq/vault/:assetId/cost-matrix',
        x402Gatekeeper({ priceMicroUSD: 30000, resourceId: 'opermaq-vault-cost-matrix' }),
        async (req: X402AuthenticatedRequest, res) => {
            try {
                const x402Ctx = req.x402Context;
                const parsedParams = M2mAssetIdParamSchema.safeParse(req.params || {});
                if (!parsedParams.success) {
                    return res.status(400).json({ error: 'Identificador de activo requerido.' });
                }
                const { assetId } = parsedParams.data;

                const hydrated = await VaultPersistenceService.loadHydratedAssetCatalog(assetId);
                if (!hydrated.exists || !hydrated.data) {
                    return res.status(404).json({ error: 'Activo no encontrado en bóveda soberana OPERMAQ.' });
                }

                const assetData = hydrated.data;
                const cleanTraits = AssetOntologyEngine.inferAssetPhysicalTraits({
                    type_key: assetData.equipment_type_key,
                    canonical_type_es: assetData.tipo_equipo,
                    categoria_equipo: assetData.categoria_equipo,
                    archetype_id: assetData.archetype_id,
                    make_oficial: assetData.make_oficial || assetData.make,
                    model_oficial: assetData.model_oficial || assetData.model,
                    caracteristicas_principales: assetData.caracteristicas_principales,
                    ambiente_operativo: assetData.ambiente_operativo,
                    contexto_operativo: assetData.contexto_operativo,
                    existing_traits: assetData.physical_traits,
                });
                const fichaDoc = (assetData.knowledge_vault?.ficha_tecnica || null) as PillarDocument | null;
                const mantencionDoc = (assetData.knowledge_vault?.pauta_mantencion ||
                    null) as PillarDocument | null;
                const expectedDigest = computeCostMatrixSourceDigest({
                    assetData,
                    fichaDoc,
                    mantencionDoc,
                    traits: cleanTraits,
                });
                const cachedMatrix = assetData.operational_cost_matrix;
                const costMatrix =
                    cachedMatrix &&
                    cachedMatrix.version === COST_MATRIX_SCHEMA_VERSION &&
                    (!expectedDigest || cachedMatrix.source_merkle_root_sha256 === expectedDigest)
                        ? cachedMatrix
                        : compileEquipmentCostMatrixFromPillars({
                              assetData: { ...assetData, physical_traits: cleanTraits },
                              fichaDoc,
                              mantencionDoc,
                          });

                return res.status(200).json({
                    success: true,
                    protocol: 'x402 Foundation v1.0',
                    region: 'southamerica-west1',
                    timestamp: new Date().toISOString(),
                    settlementMode: x402Ctx?.mode || 'VERIFIED',
                    assetId: hydrated.id,
                    make: assetData.make_oficial || assetData.make || 'GENÉRICO',
                    model: assetData.model_oficial || assetData.model || '',
                    tipo_equipo: assetData.tipo_equipo || null,
                    cost_matrix: costMatrix,
                });
            } catch (err: any) {
                console.error('[M2M-VAULT-COST-MATRIX] Error exportando matriz de costos M2M:', err);
                return res.status(500).json({ error: 'Error consultando matriz de costos operacionales M2M.' });
            }
        }
    );

    app.get(
        '/api/m2m/opermaq/ontology/:typeKey',
        x402Gatekeeper({ priceMicroUSD: 15000, resourceId: 'opermaq-asset-ontology' }),
        async (req: X402AuthenticatedRequest, res) => {
            try {
                const x402Ctx = req.x402Context;
                const parsedParams = M2mOntologyTypeKeyParamSchema.safeParse(req.params || {});
                if (!parsedParams.success) {
                    return res.status(400).json({ error: 'Identificador typeKey requerido.' });
                }
                const { typeKey } = parsedParams.data;

                const typeDoc = await resolveReadOnlyEquipmentTypeOntology(typeKey);
                if (!typeDoc) {
                    return res.status(404).json({
                        error: 'Tipo de equipo no encontrado en el registro ontológico OPERMAQ.',
                    });
                }

                const traits =
                    typeDoc.physical_traits ||
                    AssetOntologyEngine.inferAssetPhysicalTraits({
                        type_key: typeDoc.type_key,
                        canonical_type_es: typeDoc.canonical_type_es,
                        categoria_equipo: typeDoc.categoria_equipo,
                        archetype_id: typeDoc.archetype_id,
                        spec_schema: typeDoc.spec_schema,
                    });

                const orderedPillars: PillarId[] = [
                    'ficha_tecnica',
                    'manual_operaciones',
                    'pauta_mantencion',
                    'matriz_riesgos',
                    'checklist_pre_op',
                ];
                const pillarBlueprints: Record<string, any> = {};
                for (const pId of orderedPillars) {
                    pillarBlueprints[pId] = AssetOntologyEngine.buildCompositionalPillarBlueprint(pId, typeDoc);
                }

                return res.status(200).json({
                    success: true,
                    protocol: 'x402 Foundation v1.0',
                    region: 'southamerica-west1',
                    timestamp: new Date().toISOString(),
                    settlementMode: x402Ctx?.mode || 'VERIFIED',
                    reused_existing_schema: true,
                    ontology: {
                        type_key: typeDoc.type_key,
                        canonical_type_es: typeDoc.canonical_type_es,
                        categoria_equipo: typeDoc.categoria_equipo,
                        physical_traits: traits,
                        spec_schema: typeDoc.spec_schema,
                        cost_schema_blueprint:
                            typeDoc.cost_schema_blueprint ||
                            AssetOntologyEngine.buildDynamicCostMatrixTaxonomy(traits, typeDoc.canonical_type_es),
                        pillar_blueprints: pillarBlueprints,
                    },
                });
            } catch (err: any) {
                console.error('[M2M-ONTOLOGY] Error exportando ontología industrial M2M:', err);
                return res.status(500).json({ error: 'Error consultando ontología industrial M2M.' });
            }
        }
    );
}
