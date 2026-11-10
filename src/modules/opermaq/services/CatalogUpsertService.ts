import admin, { db } from '../../../config/firebase';
import { AssetOntologyEngine } from './AssetOntologyEngine';
import type { AssetPhysicalTraits } from '../types/vault.types';
import {
    BRAND_SYNONYM_TO_OFFICIAL,
    buildCatalogSearchMetadata,
    ensureAssetCanonicalIndex,
    normalizeModelCode,
} from './CanonicalEntityResolver';
import { enrichCatalogProfile } from './CatalogProfileEnricher';
import { buildAndPersistAssetSymbologyPack } from './EquipmentSymbologyPackBuilder';
import { resolveOrLearnEquipmentType } from './EquipmentTypeRegistryService';
import {
    deriveEnergyConsumptionProfile,
    extractHomologousAxisValues,
    sanitizeDesignAndWorkContextItems,
    serializeCanonicalSlotsToSpecsArray,
    type CanonicalSpecSlot,
    type MachineryArchetypeId,
} from '../utils/canonicalArchetypeSpecs';
import { normalizeCatalogKey, validateIndustrialDomain } from '../utils/domainGuard';

/**
 * CATALOG UPSERT SERVICE — ETAPA 1 PURA (100% Independiente de los 5 Pilares)
 *
 * Garantiza:
 * 1. Clave determinista normalizada `catalog_key` (cero duplicados por mayúsculas o guiones).
 * 2. Validación de pertinencia industrial (`validateIndustrialDomain`).
 * 3. `knowledge_vault: null` al dar de alta el equipo (los 5 pilares se inicializan e
 *    itemizan EXCLUSIVAMENTE on-demand por el usuario en la Etapa 2).
 */

export interface UpsertCatalogParams {
    existingCatalogId?: string;
    make_oficial: string;
    model_oficial: string;
    equipment_type_key?: string;
    archetype_id?: MachineryArchetypeId;
    categoria_equipo?: string;
    tipo_equipo?: string;
    physical_traits?: AssetPhysicalTraits;
    canonical_specs?: CanonicalSpecSlot[];
    ambiente_operativo?: string[];
    contexto_operativo?: string[];
    caracteristicas_principales?: string[];
    version?: string;
    versions?: string[];
    official_url?: string;
    original_jargon?: string;
    isGeneric?: boolean;
    actorId: string;
    actorEmail?: string;
}

export interface UpsertCatalogResult {
    global_asset_id: string;
    catalog_key: string;
    already_existed: boolean;
    asset_data: Record<string, any>;
}

const INVALID_PROFILE_LABELS = new Set([
    '',
    'maquinaria pesada',
    'maquinaria',
    'equipo_pesado',
    'equipo pesado',
    'equipo_operativo',
    'equipo operativo',
]);

export function validateCatalogProfileGate(assetData: Record<string, any>): {
    valid: boolean;
    missingFields: string[];
} {
    const missing: string[] = [];
    const tipo = String(assetData.tipo_equipo || '').trim().toLowerCase();

    if (!tipo || INVALID_PROFILE_LABELS.has(tipo) || tipo.startsWith('maquinaria ')) {
        missing.push('tipo_equipo');
    }
    if (!Array.isArray(assetData.ambiente_operativo) || assetData.ambiente_operativo.length === 0) {
        missing.push('ambiente_operativo');
    }
    if (!Array.isArray(assetData.contexto_operativo) || assetData.contexto_operativo.length === 0) {
        missing.push('contexto_operativo');
    }
    if (!Array.isArray(assetData.caracteristicas_principales) || assetData.caracteristicas_principales.length === 0) {
        missing.push('caracteristicas_principales');
    }

    return {
        valid: missing.length === 0,
        missingFields: missing,
    };
}

export async function upsertGlobalAssetCatalog(params: UpsertCatalogParams): Promise<UpsertCatalogResult> {
    const rawMake = (params.make_oficial || 'GENÉRICO').trim().toUpperCase();
    const cleanMake = BRAND_SYNONYM_TO_OFFICIAL[rawMake] || rawMake;
    const cleanModel = normalizeModelCode(params.model_oficial || '');

    if (!cleanModel) {
        throw new Error('model_oficial es obligatorio para registrar un activo en el catálogo maestro.');
    }

    validateIndustrialDomain(`${cleanMake} ${cleanModel}`, params.categoria_equipo);

    const catalogKey = normalizeCatalogKey(cleanMake, cleanModel);

    const incomingVersionsToMerge = Array.from(
        new Set([
            ...(Array.isArray(params.versions) ? params.versions : []),
            ...(params.version ? [params.version] : []),
        ].map((v) => String(v || '').trim()).filter(Boolean))
    );

    const mergeExistingDocMetadata = async (docId: string, existingData: Record<string, any>) => {
        const updatePatch: Record<string, any> = {};
        if (incomingVersionsToMerge.length > 0) {
            updatePatch.versions = admin.firestore.FieldValue.arrayUnion(...incomingVersionsToMerge);
            updatePatch.chassis_versions = admin.firestore.FieldValue.arrayUnion(...incomingVersionsToMerge);
        }
        if (!existingData.physical_traits) {
            updatePatch.physical_traits =
                params.physical_traits ||
                AssetOntologyEngine.inferAssetPhysicalTraits({
                    type_key: existingData.equipment_type_key || params.equipment_type_key,
                    canonical_type_es: existingData.tipo_equipo || params.tipo_equipo || '',
                    categoria_equipo: existingData.categoria_equipo || params.categoria_equipo || '',
                    canonical_specs: existingData.canonical_specs || params.canonical_specs || [],
                });
        }
        if (Object.keys(updatePatch).length > 0) {
            await db
                .collection('global_asset_catalog')
                .doc(docId)
                .update(updatePatch)
                .catch(() => undefined);
        }
        if (params.original_jargon || !existingData.search_aliases) {
            void ensureAssetCanonicalIndex(docId, existingData, params.original_jargon);
        }
    };

    if (params.existingCatalogId) {
        const byExistingId = await db.collection('global_asset_catalog').doc(params.existingCatalogId).get();
        if (byExistingId.exists) {
            const existingData = byExistingId.data() || {};
            await mergeExistingDocMetadata(byExistingId.id, existingData);
            return {
                global_asset_id: byExistingId.id,
                catalog_key: catalogKey,
                already_existed: true,
                asset_data: { id: byExistingId.id, ...existingData },
            };
        }
    }

    // 1. Verificar existencia previa por `catalog_key` o ID directo
    const existingQuery = await db
        .collection('global_asset_catalog')
        .where('catalog_key', '==', catalogKey)
        .limit(1)
        .get();

    if (!existingQuery.empty) {
        const docSnap = existingQuery.docs[0];
        const existingData = docSnap.data() || {};
        await mergeExistingDocMetadata(docSnap.id, existingData);
        return {
            global_asset_id: docSnap.id,
            catalog_key: catalogKey,
            already_existed: true,
            asset_data: { id: docSnap.id, ...existingData },
        };
    }

    const directDoc = await db.collection('global_asset_catalog').doc(catalogKey).get();
    if (directDoc.exists) {
        const existingData = directDoc.data() || {};
        await mergeExistingDocMetadata(directDoc.id, existingData);
        return {
            global_asset_id: directDoc.id,
            catalog_key: catalogKey,
            already_existed: true,
            asset_data: { id: directDoc.id, ...existingData },
        };
    }

    // 2. Verificar si ya trae vector canónico homólogo con evidencia o si requiere el pipeline Grounded de 2 pasadas (Temp 0)
    const preExtracted = extractHomologousAxisValues({
        equipment_type_key: params.equipment_type_key,
        archetype_id: params.archetype_id,
        tipo_equipo: params.tipo_equipo,
        categoria_equipo: params.categoria_equipo,
        canonical_specs: params.canonical_specs,
        caracteristicas_principales: params.caracteristicas_principales,
    });
    const verifiedAxesCount = preExtracted.slots.filter((s) => Boolean(s.value_si && s.source_url)).length;

    const needsEnrichment =
        !params.tipo_equipo ||
        INVALID_PROFILE_LABELS.has(params.tipo_equipo.trim().toLowerCase()) ||
        verifiedAxesCount < 2;

    let resolvedTypeKey = params.equipment_type_key;
    let resolvedCanonicalTipo = params.tipo_equipo;
    if (!needsEnrichment && (!resolvedTypeKey || resolvedTypeKey.trim().length === 0)) {
        const typeRes = await resolveOrLearnEquipmentType({
            rawTypeHint: params.tipo_equipo,
            rawCategoryHint: params.categoria_equipo,
            assetQueryContext: `${cleanMake} ${cleanModel}`,
        });
        resolvedTypeKey = typeRes.typeDoc.type_key;
        resolvedCanonicalTipo = typeRes.typeDoc.canonical_type_es;
    }

    const enriched = needsEnrichment
        ? await enrichCatalogProfile(
              cleanMake,
              cleanModel,
              {
                  equipment_type_key: params.equipment_type_key,
                  archetype_id: params.archetype_id,
                  tipo_equipo: params.tipo_equipo,
                  categoria_equipo: params.categoria_equipo,
                  canonical_specs: params.canonical_specs,
                  ambiente_operativo: params.ambiente_operativo,
                  contexto_operativo: params.contexto_operativo,
                  caracteristicas_principales: params.caracteristicas_principales,
              },
              Boolean(params.isGeneric)
          )
        : {
              equipment_type_key: resolvedTypeKey,
              archetype_id: preExtracted.archetype.id,
              tipo_equipo: resolvedCanonicalTipo || params.tipo_equipo!,
              categoria_equipo: (params.categoria_equipo || 'EQUIPAMIENTO INDUSTRIAL').toUpperCase(),
              canonical_specs: preExtracted.slots,
              ambiente_operativo: sanitizeDesignAndWorkContextItems(params.ambiente_operativo),
              contexto_operativo: sanitizeDesignAndWorkContextItems(params.contexto_operativo),
              caracteristicas_principales: serializeCanonicalSlotsToSpecsArray(preExtracted.slots),
          };

    const nowMs = Date.now();
    const chassisVersions =
        params.versions && params.versions.length > 0 ? params.versions : [params.version || 'ESTÁNDAR'];
    const searchMeta = buildCatalogSearchMetadata({
        make_oficial: cleanMake,
        model_oficial: cleanModel,
        tipo_equipo: enriched.tipo_equipo,
        categoria_equipo: enriched.categoria_equipo,
        original_jargon: params.original_jargon,
    });
    const energyProfile = deriveEnergyConsumptionProfile({
        tipo_equipo: enriched.tipo_equipo,
        categoria_equipo: enriched.categoria_equipo,
        canonical_specs: enriched.canonical_specs || [],
        caracteristicas_principales: enriched.caracteristicas_principales,
        official_url: params.official_url || '',
    });
    const physicalTraits = AssetOntologyEngine.inferAssetPhysicalTraits({
        type_key: enriched.equipment_type_key || undefined,
        canonical_type_es: enriched.tipo_equipo,
        categoria_equipo: enriched.categoria_equipo,
        canonical_specs: enriched.canonical_specs || [],
        corpusText: `${cleanMake} ${cleanModel} ${(enriched.ambiente_operativo || []).join(' ')} ${(enriched.contexto_operativo || []).join(' ')}`,
        existingTraits: params.physical_traits || null,
    });
    const newCatalogDoc: Record<string, any> = {
        catalog_key: catalogKey,
        make: cleanMake,
        model: cleanModel,
        make_oficial: cleanMake,
        model_oficial: cleanModel,
        make_model: `${cleanMake} ${cleanModel}`,
        model_designator: searchMeta.model_designator,
        search_aliases: searchMeta.search_aliases,
        search_tokens: searchMeta.search_tokens,
        equipment_type_key: enriched.equipment_type_key || null,
        archetype_id: enriched.archetype_id,
        categoria_equipo: enriched.categoria_equipo,
        tipo_equipo: enriched.tipo_equipo,
        physical_traits: physicalTraits,
        canonical_specs: enriched.canonical_specs || [],
        energy_consumption_profile: energyProfile,
        ambiente_operativo: sanitizeDesignAndWorkContextItems(enriched.ambiente_operativo),
        contexto_operativo: sanitizeDesignAndWorkContextItems(enriched.contexto_operativo),
        caracteristicas_principales: enriched.caracteristicas_principales,
        alias_detectados: params.original_jargon ? [params.original_jargon] : [],
        ecosystem_dependencies: [],
        health_score: 0,
        missing_critical_elements: {},
        version: params.version || 'ESTÁNDAR',
        versions: chassisVersions,
        chassis_versions: chassisVersions,
        official_url: params.official_url || '',
        original_jargon: params.original_jargon || `${cleanMake} ${cleanModel}`,
        is_generic: Boolean(params.isGeneric || cleanMake === 'GENÉRICO'),
        is_sealed: false,
        isSealed: false,
        // REGLA INVIOLABLE: La caza inicial NO inicializa ni busca los 5 pilares.
        knowledge_vault: null,
        createdBy: params.actorId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: nowMs,
    };

    const docRef = db.collection('global_asset_catalog').doc(catalogKey);
    await docRef.set(newCatalogDoc);

    // Generar e indexar vector Matryoshka 768d + Paquete Ad-Hoc de Simbología ISO en segundo plano sin bloquear alta
    void ensureAssetCanonicalIndex(catalogKey, newCatalogDoc, params.original_jargon);
    void buildAndPersistAssetSymbologyPack(catalogKey, newCatalogDoc);

    return {
        global_asset_id: catalogKey,
        catalog_key: catalogKey,
        already_existed: false,
        asset_data: { id: catalogKey, ...newCatalogDoc },
    };
}
