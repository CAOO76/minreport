import type {
    EquipmentSymbologyPack,
    PillarId,
    SymbologyChapterApplicationRef,
    SymbologyFunctionalGroup,
    SymbologyPackEntry,
    SymbologyStandardFamily,
} from '../types/vault.types';
import { SEQUENTIAL_PILLAR_ORDER } from '../types/vault.types';
import { AssetOntologyEngine } from './AssetOntologyEngine';
import {
    getCachedMasterSymbologyIndex,
    injectVerifiedInlineSymbology,
    SYNTHETIC_ADHOC_SYMBOL_AUTHOR,
} from './NeuroSymbolicVerifier';
import { PILLAR_LABELS } from './pillarAgents';
import { VaultPersistenceService } from './VaultPersistenceService';
import { inferAssetConfigurationProfile } from '../utils/lockedVariantDirective';

export type EquipmentArchetype = string;

export function inferEquipmentArchetypeAndTags(assetData: Record<string, any>): {
    archetype: EquipmentArchetype;
    powertrainTags: string[];
} {
    const traits = AssetOntologyEngine.inferAssetPhysicalTraits({
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

    const configProfile = inferAssetConfigurationProfile({
        make_oficial: assetData.make_oficial || assetData.make,
        model_oficial: assetData.model_oficial || assetData.model,
        tipo_equipo: assetData.tipo_equipo,
        categoria_equipo: assetData.categoria_equipo,
        version: assetData.version,
        physical_traits: traits,
        canonical_specs: assetData.canonical_specs,
        caracteristicas_principales: assetData.caracteristicas_principales,
        chassis_versions: assetData.chassis_versions,
        existing_profile: assetData.configuration_profile,
    });

    const tags = new Set<string>([
        traits.mobility,
        traits.primary_energy,
        traits.operator_interface,
        traits.functional_domain,
    ]);
    if (traits.has_hydraulic_system) tags.add('HYDRAULIC_SYSTEM');
    if (traits.has_compressed_air_system) tags.add('PNEUMATIC_SYSTEM');
    if (traits.requires_metrology_calibration) tags.add('METROLOGY_CALIBRATION');

    if (configProfile.transmission_category) {
        tags.add(`TX_${configProfile.transmission_category}`);
    }
    if (configProfile.axle_or_undercarriage_config) {
        const axMatch = configProfile.axle_or_undercarriage_config.match(/\b(\d{1,2}x\d{1,2})\b/i);
        if (axMatch) {
            tags.add(`AXLE_${axMatch[1].toUpperCase()}`);
        }
    }
    if (configProfile.work_body_or_implement && /\btolva\b/i.test(configProfile.work_body_or_implement)) {
        tags.add('BODY_DUMP_TOLVA');
    }
    if (configProfile.factory_emission_or_grid_spec) {
        if (/\bdpf\b|tier\s*4|stage\s*(?:iiib|iv|v)|euro\s*vi/i.test(configProfile.factory_emission_or_grid_spec)) {
            tags.add('AFTERTREATMENT_DPF');
        }
        if (/\bscr\b|adblue|\bdef\b|euro\s*v/i.test(configProfile.factory_emission_or_grid_spec)) {
            tags.add('AFTERTREATMENT_SCR_DEF');
        }
    }

    return {
        archetype: `${traits.functional_domain}:${traits.iso_14224_equipment_class}`,
        powertrainTags: Array.from(tags),
    };
}

function classifySymbolIntoGroup(docData: Record<string, any>): SymbologyFunctionalGroup {
    const family: string = docData.standard_family || '';
    const code: string = String(docData.iso_code || docData.iso_reference || '').toUpperCase();

    if (family === 'ISO_7010') {
        if (code.includes('M0') || docData.iso_category === 'mandatory') {
            return 'MANDATORY_PPE';
        }
        return 'HAZARD_PROHIBITION';
    }
    if (family === 'GHS' || family === 'IEC_60417') {
        return 'MAINTENANCE_FLUIDS_ELECTRICAL';
    }

    const id = String(docData.concept_id || '').toLowerCase();
    if (
        id.includes('filter') ||
        id.includes('level') ||
        id.includes('grease') ||
        id.includes('disconnect') ||
        id.includes('water_in_fuel') ||
        id.includes('def_adblue')
    ) {
        return 'MAINTENANCE_FLUIDS_ELECTRICAL';
    }

    return 'CABIN_TELLTALES_CONTROLS';
}

/**
 * Compila y persiste el paquete real de simbología verificada en `global_asset_catalog/{assetId}.symbology_pack`
 * sin especulación por arquetipo: solo incluye los símbolos efectivamente aplicados en los capítulos del activo
 * o vectorizados desde sus manuales PDF OEM.
 */
export async function buildAndPersistAssetSymbologyPack(
    assetId: string,
    existingAssetData?: Record<string, any>
): Promise<EquipmentSymbologyPack> {
    const cachedSymbology = await getCachedMasterSymbologyIndex();

    const hasInlinePillarItems =
        existingAssetData?.knowledge_vault &&
        SEQUENTIAL_PILLAR_ORDER.some((pid) => Array.isArray(existingAssetData.knowledge_vault[pid]?.items));

    const hydrated = hasInlinePillarItems
        ? { exists: true, data: existingAssetData }
        : await VaultPersistenceService.loadHydratedAssetCatalog(assetId);
    const assetData = hydrated.data || existingAssetData || {};

    const makeLower = String(assetData.make_oficial || assetData.make || '')
        .trim()
        .toLowerCase();
    const makeModel =
        assetData.make_model ||
        `${assetData.make_oficial || assetData.make || ''} ${assetData.model_oficial || assetData.model || assetId}`.trim();

    const { archetype, powertrainTags } = inferEquipmentArchetypeAndTags(assetData);

    const chapterApplicationsByConcept = new Map<string, SymbologyChapterApplicationRef[]>();
    const pillarLabelsByConcept = new Map<string, Set<string>>();

    const addConceptApplication = (
        cid: string,
        app: SymbologyChapterApplicationRef
    ) => {
        const cleanCid = String(cid || '').trim();
        if (!cleanCid) return;
        const list = chapterApplicationsByConcept.get(cleanCid) || [];
        if (!list.some((x) => x.pillar_id === app.pillar_id && x.item_id === app.item_id)) {
            list.push(app);
            chapterApplicationsByConcept.set(cleanCid, list);
        }
        const pSet = pillarLabelsByConcept.get(cleanCid) || new Set<string>();
        pSet.add(app.pillar_label);
        pillarLabelsByConcept.set(cleanCid, pSet);
    };

    const vault = assetData.knowledge_vault;
    if (vault && typeof vault === 'object') {
        for (const pillarId of SEQUENTIAL_PILLAR_ORDER) {
            const pillarLabel = PILLAR_LABELS[pillarId as PillarId] || pillarId;
            const items = vault[pillarId]?.items;
            if (!Array.isArray(items)) continue;

            for (const item of items) {
                if (item?.is_discarded) continue;
                const contentStr = String(item?.content || '').trim();
                if (item?.content_status !== 'COMPLETADO' || !contentStr) continue;

                const itemId = String(item?.item_id || '');
                const chapterTitle = String(item?.title || 'Capítulo Técnico');

                const inlineAnalysis = await injectVerifiedInlineSymbology(contentStr, { pillarId });
                const explicitlyDetected = new Set(inlineAnalysis.detectedConceptIds);

                for (const cid of inlineAnalysis.detectedConceptIds) {
                    const excerpt =
                        inlineAnalysis.applicationsByConcept[cid] ||
                        `Aplicado en el contenido técnico de "${chapterTitle}" (${pillarLabel})`;
                    addConceptApplication(cid, {
                        pillar_id: pillarId,
                        pillar_label: pillarLabel,
                        item_id: itemId,
                        item_title: chapterTitle,
                        context_excerpt: excerpt,
                    });
                }

                if (Array.isArray(item?.symbology_refs)) {
                    for (const ref of item.symbology_refs) {
                        const cid = typeof ref === 'string' ? ref : ref?.concept_id;
                        if (!cid || !explicitlyDetected.has(String(cid))) continue;
                        const excerpt =
                            inlineAnalysis.applicationsByConcept[cid] ||
                            `Aplicado en el contenido técnico de "${chapterTitle}" (${pillarLabel})`;
                        addConceptApplication(String(cid), {
                            pillar_id: pillarId,
                            pillar_label: pillarLabel,
                            item_id: itemId,
                            item_title: chapterTitle,
                            context_excerpt: excerpt,
                        });
                    }
                }
            }
        }
    }

    // Incluir símbolos OEM extraídos y vectorizados desde los PDFs de este equipo (resolución en RAM: 0 lecturas)
    for (const [docId, d] of cachedSymbology.docsById.entries()) {
        if (d.source_asset_id !== assetId) continue;
        addConceptApplication(docId, {
            pillar_id: 'manual_operaciones',
            pillar_label: 'Manual OEM Vectorizado',
            item_id: `oem_pdf_p${d.source_page || 1}`,
            item_title: `Pictograma OEM Pág. ${d.source_page || 1}`,
            context_excerpt:
                d.action_operator_es ||
                d.description_es ||
                `Extraído directamente del manual PDF oficial de ${makeModel}.`,
        });
    }

    const groups: Record<SymbologyFunctionalGroup, SymbologyPackEntry[]> = {
        MANDATORY_PPE: [],
        HAZARD_PROHIBITION: [],
        CABIN_TELLTALES_CONTROLS: [],
        MAINTENANCE_FLUIDS_ELECTRICAL: [],
    };
    let totalSymbols = 0;

    for (const cid of chapterApplicationsByConcept.keys()) {
        const d = cachedSymbology.docsById.get(cid);
        if (!d) continue;
        if (d.created_by === SYNTHETIC_ADHOC_SYMBOL_AUTHOR) continue;

        const brandVariant =
            (makeLower && d.brands_variants?.[makeLower]) ||
            (makeLower && d.brand_variants?.[makeLower.toUpperCase()]);
        const isBrandVerified = Boolean(
            brandVariant?.verified_by_human && brandVariant?.asset_storage_url
        );
        const iconUrl = isBrandVerified
            ? brandVariant.asset_storage_url
            : d.standard_icon_url || '';

        if (!iconUrl && !d.svg_inline) continue;

        const group = classifySymbolIntoGroup(d);
        const family: SymbologyStandardFamily =
            d.standard_family ||
            (/7010/i.test(d.iso_reference || '')
                ? 'ISO_7010'
                : /60417/i.test(d.iso_reference || '')
                    ? 'IEC_60417'
                    : /2575/i.test(d.iso_reference || '')
                        ? 'ISO_2575'
                        : /ghs/i.test(d.iso_reference || '')
                            ? 'GHS'
                            : 'ISO_7000');

        const chapterApps = chapterApplicationsByConcept.get(cid) || [];
        const pillarList = Array.from(pillarLabelsByConcept.get(cid) || []);
        const specificApplicationSummary =
            chapterApps.length > 0
                ? chapterApps
                    .slice(0, 3)
                    .map((ca) => `[${ca.pillar_label} ➔ ${ca.item_title}]: ${ca.context_excerpt}`)
                    .join(' | ')
                : d.action_operator_es || d.description_es || '';

        const entry: SymbologyPackEntry = {
            concept_id: cid,
            standard_family: family,
            iso_reference: d.iso_reference || cid.toUpperCase(),
            group,
            technical_name_es: d.technical_name_es || cid,
            action_operator_es: d.action_operator_es || d.description_es || '',
            equipment_specific_application_es: specificApplicationSummary,
            applied_in_pillars: pillarList,
            applied_in_chapters: chapterApps,
            critical_color: d.critical_color || 'NONE',
            icon_url: iconUrl,
            ...(!isBrandVerified && d.svg_inline ? { svg_inline: d.svg_inline } : {}),
            is_brand_specific: isBrandVerified,
            source_layer: 'OEM_MANUAL',
            ...(typeof d.original_bytes === 'number' ? { original_bytes: d.original_bytes } : {}),
            ...(typeof d.optimized_bytes === 'number' ? { optimized_bytes: d.optimized_bytes } : {}),
            ...(typeof d.savings_pct === 'number' ? { savings_pct: d.savings_pct } : {}),
        };

        groups[group].push(entry);
        totalSymbols += 1;
    }

    const pack: EquipmentSymbologyPack = {
        generated_at: new Date().toISOString(),
        archetype_key: archetype,
        powertrain_tags: powertrainTags,
        total_symbols: totalSymbols,
        groups,
    };

    if (hydrated.exists) {
        await VaultPersistenceService.saveDerivedSymbologyPack(assetId, pack).catch(() => { });
    }

    return pack;
}

