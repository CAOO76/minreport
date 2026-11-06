import { db } from '../../../config/firebase';
import type {
    EquipmentSymbologyPack,
    SymbologyFunctionalGroup,
    SymbologyPackEntry,
    SymbologyStandardFamily,
} from '../types/vault.types';
import { ensureUniversalSymbologySeeded } from './UniversalSymbologySeedService';

/**
 * EQUIPMENT SYMBOLOGY PACK BUILDER v4.0
 *
 * Ensambla automáticamente el paquete completo de simbología normativa aplicable
 * a CUALQUIER maquinaria, vehículo, herramienta o instrumento cargado en MINREPORT,
 * sin requerir carga manual.
 *
 * Modelo de Ensamblaje en 3 Capas + Símbolos OEM Descubiertos:
 * - Capa 1: Arquetipo Físico del Equipo (Movimiento de Tierra, Perforación Subterránea,
 *   Camioneta/Camión, Levante/Izaje, Herramienta Eléctrica, Compresor/Generador/Soldadora).
 * - Capa 2: Delta Tecnológico y Motorización (Diésel Tier 4 DPF/DEF, Hidráulica High-Flow,
 *   Neumática, Clase II Doble Aislamiento, Cabina ROPS/FOPS, Acoplador Rápido).
 * - Capa 3: Contexto Operativo de Faena (Subterránea, Rajo/Gran Altitud, Taller, Hidrometalurgia)
 *   + todos los `symbology_refs` vinculados en los 5 pilares del activo.
 */

export type EquipmentArchetype =
    | 'EARTHMOVING_HEAVY'
    | 'UNDERGROUND_DRILL_JUMBO'
    | 'ROAD_MINING_VEHICLE'
    | 'LIFTING_CRANE_TELEHANDLER'
    | 'ROTARY_PERCUSSIVE_POWER_TOOL'
    | 'STATIONARY_GENSET_COMPRESSOR_WELDER'
    | 'INDUSTRIAL_GENERAL';

const ARCHETYPE_BASE_CONCEPTS: Record<EquipmentArchetype, string[]> = {
    EARTHMOVING_HEAVY: [
        // EPP Mandatorio
        'iso_7010_m002',
        'iso_7010_m014',
        'iso_7010_m015',
        'iso_7010_m008',
        'iso_7010_m003',
        'iso_7010_m004',
        'iso_7010_m009',
        'iso_7010_m020',
        'iso_7010_m021',
        // Riesgos, Emergencia y Prohibiciones
        'iso_7010_w014',
        'iso_7010_w019',
        'iso_7010_w008',
        'iso_7010_w011',
        'iso_7010_w017',
        'iso_7010_w024',
        'iso_7010_w029',
        'iso_7010_p004',
        'iso_7010_p015',
        'iso_7010_p031',
        'iso_7010_f001',
        'iso_7010_e001',
        // Cabina, Testigos y Controles
        'iso_7000_0248_engine_oil_pressure',
        'iso_7000_0246_coolant_temperature',
        'iso_7000_0247_battery_charging',
        'iso_7000_0238_parking_brake',
        'iso_7000_0239_brake_system_failure',
        'iso_7000_0249_seatbelt_reminder',
        'iso_7000_1409_hydraulic_oil_pressure',
        'iso_7000_1411_hydraulic_oil_temp',
        'iso_7000_1156_transmission_oil_temp',
        'iso_7000_1371_two_speed_rabbit_turtle',
        'iso_7000_0029_horn_audible_warning',
        'iso_7000_1141_beacon_strobe_light',
        // Mantención, Fluidos y Bloqueo
        'iso_7000_0639_master_battery_disconnect',
        'iso_7000_0245_fuel_level',
        'iso_7000_1410_hydraulic_oil_level',
        'iso_7000_1412_hydraulic_oil_filter',
        'iso_7000_1168_engine_air_filter',
        'iso_7000_0791_grease_lubrication_point',
        'ghs_02_flammable_liquids',
        'ghs_07_irritant_sensitizer',
        'ghs_09_environmental_spill_hazard',
    ],
    UNDERGROUND_DRILL_JUMBO: [
        'iso_7010_m002',
        'iso_7010_m014',
        'iso_7010_m015',
        'iso_7010_m003',
        'iso_7010_m004',
        'iso_7010_m008',
        'iso_7010_m009',
        'iso_7010_m017',
        'iso_7010_m021',
        'iso_7010_w019',
        'iso_7010_w024',
        'iso_7010_w029',
        'iso_7010_w011',
        'iso_7010_p015',
        'iso_7010_p031',
        'iso_7010_f001',
        'iso_7000_pneumatic_air_pressure',
        'iso_7000_1409_hydraulic_oil_pressure',
        'iso_7000_1410_hydraulic_oil_level',
        'iso_7000_0791_grease_lubrication_point',
        'iso_7000_0639_master_battery_disconnect',
        'ghs_04_compressed_gas',
        'ghs_07_irritant_sensitizer',
        'ghs_08_health_hazard_silica_fumes',
    ],
    ROAD_MINING_VEHICLE: [
        'iso_7010_m002',
        'iso_7010_m020',
        'iso_7010_m014',
        'iso_7010_m015',
        'iso_7010_m008',
        'iso_7010_w001',
        'iso_7010_w011',
        'iso_7010_w017',
        'iso_7010_p002',
        'iso_7010_f001',
        'iso_7010_e003',
        'iso_7000_0248_engine_oil_pressure',
        'iso_7000_0246_coolant_temperature',
        'iso_7000_0247_battery_charging',
        'iso_7000_0238_parking_brake',
        'iso_7000_0239_brake_system_failure',
        'iso_7000_0249_seatbelt_reminder',
        'iso_2575_check_engine_mil',
        'iso_2575_four_wheel_drive_4wd',
        'iso_2575_tpms_tire_pressure',
        'iso_7000_0029_horn_audible_warning',
        'iso_7000_1141_beacon_strobe_light',
        'iso_7000_0639_master_battery_disconnect',
        'iso_7000_0245_fuel_level',
        'iso_7000_1168_engine_air_filter',
        'ghs_02_flammable_liquids',
        'ghs_05_corrosive_battery_acid',
    ],
    LIFTING_CRANE_TELEHANDLER: [
        'iso_7010_m002',
        'iso_7010_m014',
        'iso_7010_m015',
        'iso_7010_m008',
        'iso_7010_m009',
        'iso_7010_m018',
        'iso_7010_m020',
        'iso_7010_m021',
        'iso_7010_w015',
        'iso_7010_w012',
        'iso_7010_w019',
        'iso_7010_w008',
        'iso_7010_w029',
        'iso_7010_p004',
        'iso_7010_p031',
        'iso_7010_f001',
        'iso_7000_1409_hydraulic_oil_pressure',
        'iso_7000_1411_hydraulic_oil_temp',
        'iso_7000_1410_hydraulic_oil_level',
        'iso_7000_1658_quick_coupler_lock',
        'iso_7000_0238_parking_brake',
        'iso_7000_1371_two_speed_rabbit_turtle',
        'iso_7000_0029_horn_audible_warning',
        'iso_7000_1141_beacon_strobe_light',
        'iso_7000_0639_master_battery_disconnect',
        'iso_7000_0791_grease_lubrication_point',
    ],
    ROTARY_PERCUSSIVE_POWER_TOOL: [
        'iso_7010_m002',
        'iso_7010_m003',
        'iso_7010_m004',
        'iso_7010_m013',
        'iso_7010_m009',
        'iso_7010_m008',
        'iso_7010_m017',
        'iso_7010_m006',
        'iso_7010_w012',
        'iso_7010_w024',
        'iso_7010_w025',
        'iso_7010_w017',
        'iso_7010_w021',
        'iso_7010_p010',
        'iso_7010_p015',
        'iso_7010_p031',
        'iec_60417_5172_class_ii_double_insulation',
        'iec_60417_5032_alternating_current_ac',
        'iec_60417_5031_direct_current_dc',
        'iso_7000_0791_grease_lubrication_point',
        'ghs_08_health_hazard_silica_fumes',
    ],
    STATIONARY_GENSET_COMPRESSOR_WELDER: [
        'iso_7010_m002',
        'iso_7010_m003',
        'iso_7010_m004',
        'iso_7010_m005',
        'iso_7010_m009',
        'iso_7010_m021',
        'iso_7010_w012',
        'iso_7010_w018',
        'iso_7010_w017',
        'iso_7010_w029',
        'iso_7010_p002',
        'iso_7010_p011',
        'iso_7010_p031',
        'iso_7010_f001',
        'iec_60417_5019_protective_earth',
        'iec_60417_5032_alternating_current_ac',
        'iec_60417_5036_dangerous_voltage',
        'iso_7000_0248_engine_oil_pressure',
        'iso_7000_0246_coolant_temperature',
        'iso_7000_0247_battery_charging',
        'iso_7000_0639_master_battery_disconnect',
        'iso_7000_0245_fuel_level',
        'iso_7000_1168_engine_air_filter',
        'ghs_02_flammable_liquids',
    ],
    INDUSTRIAL_GENERAL: [
        'iso_7010_m002',
        'iso_7010_m014',
        'iso_7010_m004',
        'iso_7010_m008',
        'iso_7010_m009',
        'iso_7010_m021',
        'iso_7010_w001',
        'iso_7010_w012',
        'iso_7010_w024',
        'iso_7010_p031',
        'iso_7010_f001',
        'iec_60417_5019_protective_earth',
        'iso_7000_0639_master_battery_disconnect',
    ],
};

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
    } else if (/(camioneta|pickup|hilux|l200|ranger|navara|furg[oó]n|bus|tracto|cami[oó]n aljibe|cami[oó]n pluma|veh[ií]culo liviano)/.test(hay)) {
        archetype = 'ROAD_MINING_VEHICLE';
    } else if (
        /(minicargador|skid steer|excavadora|retroexcavadora|cargador|bulldozer|tractor|motoniveladora|rodillo|compactador|dumper|cami[oó]n minero|palas|movimiento de tierra|242d|320|d8t)/.test(
            hay
        )
    ) {
        archetype = 'EARTHMOVING_HEAVY';
    }

    const tags = new Set<string>();
    if (/(di[eé]sel|c3\.3|cummins|perkins|cat c|motor t[eé]rmico|petr[oó]leo)/.test(hay) || archetype === 'EARTHMOVING_HEAVY') {
        tags.add('DIESEL');
    }
    if (/(tier 4|stage v|dpf|adblue|scr|def|common rail)/.test(hay)) {
        tags.add('TIER4_DPF_DEF');
    }
    if (/(high flow|xps|hidr[aá]ulic|caudal|acople|aditamento|martillo hidr)/.test(hay) || archetype === 'EARTHMOVING_HEAVY') {
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
    if (family === 'GHS') {
        return 'MAINTENANCE_FLUIDS_ELECTRICAL';
    }
    if (family === 'IEC_60417') {
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
 * Construye y persiste el paquete completo de simbología ad-hoc en `global_asset_catalog/{assetId}.symbology_pack`
 */
export async function buildAndPersistAssetSymbologyPack(
    assetId: string,
    existingAssetData?: Record<string, any>
): Promise<EquipmentSymbologyPack> {
    await ensureUniversalSymbologySeeded(false);

    const docRef = db.collection('global_asset_catalog').doc(assetId);
    const assetData = existingAssetData || (await docRef.get()).data() || {};
    const makeLower = String(assetData.make_oficial || assetData.make || '')
        .trim()
        .toLowerCase();

    const { archetype, powertrainTags } = inferEquipmentArchetypeAndTags(assetData);

    const conceptSources = new Map<string, SymbologyPackEntry['source_layer']>();

    // Capa 1: Arquetipo base
    for (const cid of ARCHETYPE_BASE_CONCEPTS[archetype]) {
        conceptSources.set(cid, 'ARCHETYPE');
    }

    // Capa 2: Delta de motorización y acoplamientos
    if (powertrainTags.includes('DIESEL')) {
        conceptSources.set('iso_7000_1393_water_in_fuel', 'POWERTRAIN_TECH');
        conceptSources.set('iso_7000_0457_glow_plug_preheat', 'POWERTRAIN_TECH');
        conceptSources.set('iso_2575_check_engine_mil', 'POWERTRAIN_TECH');
        conceptSources.set('ghs_05_corrosive_battery_acid', 'POWERTRAIN_TECH');
        conceptSources.set('iso_7010_w026', 'POWERTRAIN_TECH');
    }
    if (powertrainTags.includes('TIER4_DPF_DEF')) {
        conceptSources.set('iso_7000_2433_dpf_regeneration', 'POWERTRAIN_TECH');
        conceptSources.set('iso_7000_2946_def_adblue', 'POWERTRAIN_TECH');
    }
    if (powertrainTags.includes('HIGH_FLOW_COUPLED_HYDRAULICS')) {
        conceptSources.set('iso_7000_1658_quick_coupler_lock', 'POWERTRAIN_TECH');
        conceptSources.set('iso_7000_1665_auxiliary_hydraulics_high_flow', 'POWERTRAIN_TECH');
    }
    if (powertrainTags.includes('PNEUMATIC')) {
        conceptSources.set('iso_7000_pneumatic_air_pressure', 'POWERTRAIN_TECH');
        conceptSources.set('ghs_04_compressed_gas', 'POWERTRAIN_TECH');
    }
    if (powertrainTags.includes('BATTERY_ELECTRIC')) {
        conceptSources.set('iec_60417_5031_direct_current_dc', 'POWERTRAIN_TECH');
        conceptSources.set('iec_60417_5036_dangerous_voltage', 'POWERTRAIN_TECH');
        conceptSources.set('iso_7010_w026', 'POWERTRAIN_TECH');
    }

    // Capa 3: Contexto operativo de faena + Símbolos referenciados en la Bóveda de 5 Pilares
    if (powertrainTags.includes('UNDERGROUND_FAENA')) {
        conceptSources.set('iso_7010_m017', 'TENANT_FAENA');
        conceptSources.set('ghs_08_health_hazard_silica_fumes', 'TENANT_FAENA');
        conceptSources.set('iso_7010_e001', 'TENANT_FAENA');
    }
    if (powertrainTags.includes('HIGH_ALTITUDE_COLD')) {
        conceptSources.set('iso_7010_w010', 'TENANT_FAENA');
        conceptSources.set('iso_7000_0457_glow_plug_preheat', 'TENANT_FAENA');
    }

    const vault = assetData.knowledge_vault;
    if (vault && typeof vault === 'object') {
        for (const pillarKey of Object.keys(vault)) {
            const items = vault[pillarKey]?.items;
            if (Array.isArray(items)) {
                for (const item of items) {
                    if (Array.isArray(item?.symbology_refs)) {
                        for (const ref of item.symbology_refs) {
                            const cid = typeof ref === 'string' ? ref : ref?.concept_id;
                            if (cid && !conceptSources.has(cid)) {
                                conceptSources.set(String(cid), 'OEM_MANUAL');
                            }
                        }
                    }
                }
            }
        }
    }

    const groups: Record<SymbologyFunctionalGroup, SymbologyPackEntry[]> = {
        MANDATORY_PPE: [],
        HAZARD_PROHIBITION: [],
        CABIN_TELLTALES_CONTROLS: [],
        MAINTENANCE_FLUIDS_ELECTRICAL: [],
    };

    const conceptIds = Array.from(conceptSources.keys());
    const snaps = await Promise.all(
        conceptIds.map((cid) => db.collection('master_symbology_vault').doc(cid).get())
    );

    for (let i = 0; i < snaps.length; i++) {
        const snap = snaps[i];
        if (!snap.exists) continue;
        const d = snap.data()!;
        const cid = snap.id;
        const layer = conceptSources.get(cid) || 'ARCHETYPE';

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

        groups[group].push({
            concept_id: cid,
            standard_family: family,
            iso_reference: d.iso_reference || cid.toUpperCase(),
            group,
            technical_name_es: d.technical_name_es || cid,
            action_operator_es: d.action_operator_es || d.description_es || '',
            critical_color: d.critical_color || 'NONE',
            icon_url: iconUrl,
            ...(!isBrandVerified && d.svg_inline ? { svg_inline: d.svg_inline } : {}),
            is_brand_specific: isBrandVerified,
            source_layer: layer,
        });
    }

    const totalSymbols =
        groups.MANDATORY_PPE.length +
        groups.HAZARD_PROHIBITION.length +
        groups.CABIN_TELLTALES_CONTROLS.length +
        groups.MAINTENANCE_FLUIDS_ELECTRICAL.length;

    const pack: EquipmentSymbologyPack = {
        generated_at: new Date().toISOString(),
        archetype_key: archetype,
        powertrain_tags: powertrainTags,
        total_symbols: totalSymbols,
        groups,
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
