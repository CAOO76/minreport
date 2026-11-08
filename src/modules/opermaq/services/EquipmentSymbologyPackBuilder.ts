import { db } from '../../../config/firebase';
import type {
    EquipmentSymbologyPack,
    PillarId,
    SymbologyChapterApplicationRef,
    SymbologyFunctionalGroup,
    SymbologyPackEntry,
    SymbologyStandardFamily,
} from '../types/vault.types';
import { SEQUENTIAL_PILLAR_ORDER } from '../types/vault.types';
import {
    injectVerifiedInlineSymbology,
    purgeSyntheticAdHocSymbols,
    SYNTHETIC_ADHOC_SYMBOL_AUTHOR,
} from './NeuroSymbolicVerifier';
import { PILLAR_LABELS } from './pillarAgents';
import { ensureUniversalSymbologySeeded } from './UniversalSymbologySeedService';

/**
 * EQUIPMENT SYMBOLOGY COMPILER v9.3 (CERO ESPECULACIÓN IA — SOLO COMPILADO REAL VERIFICADO)
 *
 * Compila determinísticamente la tabla real de simbología que aplica verdaderamente al equipo,
 * extrayendo únicamente:
 * 1. Los símbolos normativos (`ISO 7000`, `ISO 7010`, `ISO 2575`, `IEC 60417`, `GHS`) efectivamente
 *    referenciados o inyectados en los textos y capítulos reales de los 5 pilares del equipo (`knowledge_vault`).
 * 2. Los pictogramas vectorizados directamente desde los manuales PDF OEM cargados para este equipo
 *    (`master_symbology_vault` con `source_asset_id === assetId`).
 *
 * Cada entrada compilada registra su significado técnico normativo, la aplicación específica real
 * dentro del equipo (pilar, capítulo y extracto técnico exacto) y la telemetría de optimización CAS.
 */

export type EquipmentArchetype =
    | 'EARTHMOVING_HEAVY'
    | 'UNDERGROUND_DRILL_JUMBO'
    | 'ROAD_MINING_VEHICLE'
    | 'LIFTING_CRANE_TELEHANDLER'
    | 'ROTARY_PERCUSSIVE_POWER_TOOL'
    | 'STATIONARY_GENSET_COMPRESSOR_WELDER'
    | 'INDUSTRIAL_GENERAL';

export function inferEquipmentArchetypeAndTags(assetData: Record<string, any>): {
    archetype: EquipmentArchetype;
    powertrainTags: string[];
} {
    const hay = [
        assetData.make_oficial || assetData.make || '',
        assetData.model_oficial || assetData.model || '',
        assetData.tipo_equipo || '',
        assetData.categoria_equipo || '',
        ...(Array.isArray(assetData.ambiente_operativo) ? assetData.ambiente_operativo : []),
        ...(Array.isArray(assetData.contexto_operativo) ? assetData.contexto_operativo : []),
        ...(Array.isArray(assetData.caracteristicas_principales) ? assetData.caracteristicas_principales : []),
        ...(Array.isArray(assetData.versions) ? assetData.versions : []),
    ]
        .join(' ')
        .toLowerCase();

    let archetype: EquipmentArchetype = 'INDUSTRIAL_GENERAL';

    if (
        /(esmeril|taladro|rotomartillo|sierra|lijadora|atornillador|demoledor|herramienta el[eé]ctrica|amoladora|tronzadora)/.test(
            hay
        )
    ) {
        archetype = 'ROTARY_PERCUSSIVE_POWER_TOOL';
    } else if (/(perforadora|jumbo|jackleg|stoper|yt27|yt28|yt29|boomer|simba|raisebor|sondaje)/.test(hay)) {
        archetype = 'UNDERGROUND_DRILL_JUMBO';
    } else if (/(gr[uú]a|manipulador telesc[oó]pico|telehandler|horquilla|montacarga|alza ?hombre|manlift|izaje|puente gr[uú]a)/.test(hay)) {
        archetype = 'LIFTING_CRANE_TELEHANDLER';
    } else if (/(generador|grupo electr[oó]geno|compresor|soldadora|bomba estacionaria|tablero|subestaci[oó]n)/.test(hay)) {
        archetype = 'STATIONARY_GENSET_COMPRESSOR_WELDER';
    } else if (/(camioneta|pickup|hilux|l200|ranger|navara|furg[oó]n|fiorino|f-?350|bus|tracto|cami[oó]n aljibe|cami[oó]n pluma|veh[ií]culo liviano)/.test(hay)) {
        archetype = 'ROAD_MINING_VEHICLE';
    } else if (
        /(minicargador|skid steer|excavadora|retroexcavadora|cargador|bulldozer|tractor|motoniveladora|rodillo|compactador|dumper|cami[oó]n minero|caex|797f|palas|movimiento de tierra|242d|320|d8t)/.test(
            hay
        )
    ) {
        archetype = 'EARTHMOVING_HEAVY';
    }

    const tags = new Set<string>();
    if (/(di[eé]sel|c3\.3|cummins|perkins|cat c|power stroke|motor t[eé]rmico|petr[oó]leo)/.test(hay)) {
        tags.add('DIESEL');
    }
    if (/(tier 4|stage v|dpf|adblue|scr|def|common rail|euro 5|euro 6)/.test(hay)) {
        tags.add('TIER4_DPF_DEF');
    }
    if (/(high flow|xps|hidr[aá]ulic|caudal|acople|aditamento|martillo hidr)/.test(hay)) {
        tags.add('HIGH_FLOW_COUPLED_HYDRAULICS');
    }
    if (/(neum[aá]tic|aire comprimido|mpa|bar|psi|compresor|yt27|yt28)/.test(hay)) {
        tags.add('PNEUMATIC');
    }
    if (/(bater[ií]a|ion-litio|li-ion|h[ií]brido|ev|alta tensi[oó]n)/.test(hay)) {
        tags.add('BATTERY_ELECTRIC');
    }
    if (/(subterr[aá]ne|socav[oó]n|t[uú]nel|galer[ií]a)/.test(hay)) {
        tags.add('UNDERGROUND_FAENA');
    }
    if (/(altura|rajo|invierno|fr[ií]o)/.test(hay)) {
        tags.add('HIGH_ALTITUDE_COLD');
    }

    return {
        archetype,
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
    await ensureUniversalSymbologySeeded(false);
    await purgeSyntheticAdHocSymbols();

    const docRef = db.collection('global_asset_catalog').doc(assetId);
    const assetData = existingAssetData || (await docRef.get()).data() || {};
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
                // REGLA SOBERANA: La simbología se alimenta exclusivamente de la caza de contenidos
                // de cada ítem (nunca de los títulos o rationale generados en el itemizado).
                if (item?.content_status !== 'COMPLETADO' || !contentStr) continue;

                const itemId = String(item?.item_id || '');
                const chapterTitle = String(item?.title || 'Capítulo Técnico');

                // 1. Escanear determinísticamente únicamente el cuerpo técnico cazado del capítulo
                //    (Strict Explicit Mention Only; en `ficha_tecnica` solo códigos normativos literales).
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

                // 2. `symbology_refs` heredados solo se aceptan si su mención explícita fue verificada en el texto
                //    (descarta refs especulativos de versiones anteriores del cazador).
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

    // 3. Incluir símbolos OEM extraídos y vectorizados directamente desde los PDFs de este equipo (`source_asset_id == assetId`)
    try {
        const oemSymSnap = await db
            .collection('master_symbology_vault')
            .where('source_asset_id', '==', assetId)
            .limit(40)
            .get();
        for (const doc of oemSymSnap.docs) {
            const d = doc.data();
            addConceptApplication(doc.id, {
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
    } catch {
        // Ignorar si no hay índice o colección vacía
    }

    const groups: Record<SymbologyFunctionalGroup, SymbologyPackEntry[]> = {
        MANDATORY_PPE: [],
        HAZARD_PROHIBITION: [],
        CABIN_TELLTALES_CONTROLS: [],
        MAINTENANCE_FLUIDS_ELECTRICAL: [],
    };
    const compiledEntries: SymbologyPackEntry[] = [];

    const conceptIds = Array.from(chapterApplicationsByConcept.keys());
    const snaps = await Promise.all(
        conceptIds.map((cid) => db.collection('master_symbology_vault').doc(cid).get())
    );

    for (let i = 0; i < snaps.length; i++) {
        const snap = snaps[i];
        if (!snap.exists) continue;
        const d = snap.data()!;
        const cid = snap.id;
        // Excluir símbolos sintéticos genéricos del motor ad-hoc retirado (`SB-01`).
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
        compiledEntries.push(entry);
    }

    const totalSymbols = compiledEntries.length;

    const pack: EquipmentSymbologyPack = {
        generated_at: new Date().toISOString(),
        archetype_key: archetype,
        powertrain_tags: powertrainTags,
        total_symbols: totalSymbols,
        groups,
        compiled_entries: compiledEntries,
    };

    await docRef
        .set(
            {
                symbology_pack: pack,
                updatedAt: Date.now(),
            },
            { merge: true }
        )
        .catch(() => {});

    return pack;
}

