import type {
    AssetMobilityTrait,
    AssetPhysicalTraits,
    CostDriverUnit,
    CostMatrixTaxonomyMeta,
    DutyTravelRegimeTrait,
    EnergySourceCategory,
    EquipmentTypeAxisSchemaItem,
    EquipmentTypeConditionalSubsystemItem,
    EquipmentTypeCoreChapterItem,
    EquipmentTypePillarBlueprint,
    FunctionalDomainTrait,
    GlobalEquipmentTypeDoc,
    OperatorInterfaceTrait,
    PillarId,
    PmCadenceBasisTrait,
} from '../types/vault.types';

export interface OntologyInferenceInput {
    type_key?: string;
    canonical_type_es?: string;
    categoria_equipo?: string;
    archetype_id?: string;
    make_oficial?: string;
    model_oficial?: string;
    caracteristicas_principales?: string[];
    ambiente_operativo?: string[];
    contexto_operativo?: string[];
    corpusText?: string;
    canonical_specs?: Array<{
        axis_key?: string;
        label_es?: string;
        value_si?: string | null;
        unit_si?: string;
    }>;
    spec_schema?: EquipmentTypeAxisSchemaItem[];
    existing_traits?: Partial<AssetPhysicalTraits> | null;
    existingTraits?: Partial<AssetPhysicalTraits> | null;
}

function normalizeOntologyText(raw: string): string {
    return String(raw || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * MOTOR UNIVERSAL ZERO-CODE DE ONTOLOGÍA INDUSTRIAL POR RASGOS (`AssetOntologyEngine v3.0`).
 *
 * Sustituye listas cerradas de arquetipos y parches por marca/modelo literal por composición
 * ortogonal sobre 6 dimensiones físicas (`mobility`, `primary_energy`, `operator_interface`,
 * `duty_travel_regime`, `pm_cadence_basis`, `functional_domain`).
 *
 * Ningún activo desconocido cae jamás a un fallback de excavadora o movimiento de tierra.
 */
export class AssetOntologyEngine {
    static inferAssetPhysicalTraits(input: OntologyInferenceInput): AssetPhysicalTraits {
        const text = normalizeOntologyText(
            [
                input.type_key || '',
                input.canonical_type_es || '',
                input.categoria_equipo || '',
                input.archetype_id || '',
                input.make_oficial || '',
                input.model_oficial || '',
                ...(Array.isArray(input.caracteristicas_principales) ? input.caracteristicas_principales : []),
                ...(Array.isArray(input.ambiente_operativo) ? input.ambiente_operativo : []),
                ...(Array.isArray(input.contexto_operativo) ? input.contexto_operativo : []),
                input.corpusText || '',
                ...(Array.isArray(input.canonical_specs)
                    ? input.canonical_specs.map(
                          (s) => `${s.axis_key || ''} ${s.label_es || ''} ${s.value_si || ''} ${s.unit_si || ''}`
                      )
                    : []),
                ...(Array.isArray(input.spec_schema)
                    ? input.spec_schema.map((s) => `${s.axis_key} ${s.label_es} ${s.unit_si || ''}`)
                    : []),
            ].join(' ')
        );

        const isAerialRpas =
            /\b(dron|drone|rpas|uav|uas|multirrotor|cuadricoptero|hexacoptero|ala fija|matrice|mavic|wingtra|sensefly|ebee|lidar aereo|aerofotogrametria)\b/.test(
                text
            );
        const isBoltingOrTool =
            /\b(llave de torque|torquimetro|multiplicador de torque|tensionador de pernos|hytorc|rad torque|enerpac|llave de impacto|esmeril|amoladora|taladro|rotomartillo|atornillador|tronzadora|sierra circular|cortadora manual|herramienta manual|herramienta hidraulica|herramienta electrica|herramienta neumatica|cilindro hidraulico portatil|gato hidraulico|prensa hidraulica|extractor hidraulico)\b/.test(
                text
            );
        const isMetrologyInstrument =
            /\b(estacion total|receptor gnss|gps rtk|escaner laser|lidar terrestre|nivel topografico|teodolito|analizador|espectrometro|calibrador|manometro patron|multimetro|megohmetro|camara termografica|instrumento|metrologia)\b/.test(
                text
            );
        const isLightingTower =
            /\b(torre de iluminacion|luminaria movil|mastil de iluminacion|carro de iluminacion|hilight|torre solar|planta de iluminacion)\b/.test(
                text
            );
        const isWelder =
            /\b(soldadora|motosoldadora|maquina de soldar|arco sumergido|tig\b|mig\b|mag\b|multiproceso|big blue|trailblazer|inversora de soldadura|termofusion|electrofusion)\b/.test(
                text
            );
        const isGensetOrPower =
            /\b(generador|grupo electrogeno|planta electrica|subestacion|transformador|banco de baterias|ups industrial|inversor solar)\b/.test(
                text
            );
        const isPumpOrCompressor =
            /\b(bomba sumergible|electrobomba|motobomba|bomba centrifuga|bomba de pulpa|bomba peristaltica|bomba multietapa|bomba hidraulica de trasvasije|grindex|flygt|warman|compresor|soplador|unidad hidraulica|power pack hidraulico)\b/.test(
                text
            );
        const isComminutionOrPlant =
            /\b(chancador|trituradora|molino|harnero|zaranda|criba|lokotrack|mobirex|mobicone|mobiscreen|alimentador vibratorio|correa transportadora|apilador|stacker|planta dosificadora|planta de hormigon|planta de asfalto)\b/.test(
                text
            );
        const isCableShovelOrDragline =
            /\b(pala electrica|pala de cables|pala mecanica de cables|dragalina|4100xpc|4800xpc|7495|rope shovel)\b/.test(
                text
            );
        const isDrillingOrSupport =
            /\b(perforadora|jumbo|simba|boomer|sondaje|diamantina|jackleg|stoper|raisebor|roc\b|smartroc|flexiroc|dth\b|empernador|bolter|robot shotcrete|proyectadora de hormigon)\b/.test(
                text
            );
        const isLiftingOrRigging =
            /\b(grua|camion pluma|puente grua|polipasto|tecle|winche|huinche|manipulador telescopico|telehandler|horquilla|montacargas|apilador electrico|alza ?hombre|plataforma elevadora|manlift|boom lift|scissor lift|sideboom|tiendetubos)\b/.test(
                text
            );
        const isSurfaceMillingOrCompaction =
            /\b(fresadora|recicladora de asfalto|pavimentadora|terminadora de asfalto|rodillo compactador|compactador vibratorio|placa compactadora|vibropison|apisonador)\b/.test(
                text
            );
        const isTowedTrailer =
            !isLightingTower &&
            /\b(carro de arrastre|remolque|semirremolque|cama baja|lowboy|acoplado|cisterna remolcada|estanque remolcado|dolly|sin propulsion propia)\b/.test(
                text
            ) &&
            !/\b(tractocamion|autopropulsad)\b/.test(text);
        const isOffRoadMiningHaul =
            /\b(camion de extraccion|caex|camion minero|ultra class|camion articulado|dumper articulado|dumper subterraneo|camion bajo perfil|th663|ad60|797f|793f|789d|930e|980e|830e)\b/.test(
                text
            );
        const isVocationalServiceVehicle =
            !isOffRoadMiningHaul &&
            /\b(camion lubricador|camion aljibe|camion cisterna|camion combustible|camion fabrica|camion mixer|camion hormigonero|camion aspirador|camion limpiafosas|camion grua|camion pluma|camion mantenimiento|ambulancia|carro bomba|vehiculo de rescate|camion canasta|hidroelevador)\b/.test(
                text
            );
        const isRoadOrSiteTruckOrLightVehicle =
            !isOffRoadMiningHaul &&
            !isVocationalServiceVehicle &&
            /\b(camion tolva|camion volquete|tractocamion|camion 6x4|camion 8x4|camion 4x2|camion plano|camion baranda|camioneta|pick ?up|furgon|suv|van|minibus|bus|vehiculo liviano|utilitario|cuatrimoto|utv\b|mack|scania|volvo fh|volvo fmx|mercedes actros|mercedes arocs|kenworth|freightliner|international|hilux|l200|ranger|navara|amarok|dmax)\b/.test(
                text
            );
        const isEarthmoving =
            !isComminutionOrPlant &&
            !isSurfaceMillingOrCompaction &&
            /\b(excavadora|retroexcavadora|cargador frontal|lhd|scooptram|minicargador|skid steer|bulldozer|tractor sobre orugas|tractor de cadenas|wheel dozer|motoniveladora|trailla|mototrailla|pala hidraulica)\b/.test(
                text
            );

        // 1. Dominio Funcional
        let functional_domain: FunctionalDomainTrait = 'INDUSTRIAL_GENERAL';
        if (isAerialRpas || isMetrologyInstrument) functional_domain = 'SURVEY_INSPECTION_RPAS';
        else if (isBoltingOrTool) functional_domain = 'BOLTING_TORQUE_AND_TOOLS';
        else if (isLightingTower || isWelder || isGensetOrPower) functional_domain = 'POWER_GEN_WELDING_LIGHTING';
        else if (isPumpOrCompressor) functional_domain = 'FLUID_PUMPING_AND_AIR';
        else if (isComminutionOrPlant) functional_domain = 'COMMINUTION_AND_SCREENING';
        else if (isDrillingOrSupport) functional_domain = 'DRILLING_AND_GROUND_SUPPORT';
        else if (isLiftingOrRigging) functional_domain = 'LIFTING_AND_RIGGING';
        else if (isSurfaceMillingOrCompaction) functional_domain = 'SURFACE_MILLING_COMPACTION';
        else if (isVocationalServiceVehicle) functional_domain = 'VOCATIONAL_SERVICE_SUPPORT';
        else if (isOffRoadMiningHaul || isRoadOrSiteTruckOrLightVehicle || isTowedTrailer) {
            functional_domain = 'HAULAGE_AND_TRANSPORT';
        } else if (isCableShovelOrDragline || isEarthmoving) {
            functional_domain = 'EARTHMOVING_EXCAVATION';
        }

        // 2. Movilidad Física
        let mobility: AssetMobilityTrait = 'SKID_STATIONARY';
        if (isAerialRpas || /\b(barcaza|lancha|dron acuatico|rov submarino)\b/.test(text)) {
            mobility = 'AERIAL_OR_MARINE';
        } else if (
            isBoltingOrTool ||
            isMetrologyInstrument ||
            /\b(manual|portatil|de mano|jackleg|stoper|placa compactadora|vibropison|motosierra)\b/.test(text)
        ) {
            mobility = 'PORTABLE_OR_HANDHELD';
        } else if (
            /\b(aditamento|implemento|balde desmontable|cucharon desmontable|martillo hidraulico desmontable|garra desmontable|horquilla porta ?palet|cabezal procesador)\b/.test(
                text
            ) &&
            !isEarthmoving &&
            !isCableShovelOrDragline &&
            !isLiftingOrRigging &&
            !isDrillingOrSupport
        ) {
            mobility = 'ATTACHMENT_IMPLEMENT';
        } else if (
            isTowedTrailer ||
            (isLightingTower && !/\b(orugas|autopropulsad|portatil de mano)\b/.test(text)) ||
            (/\b(remolcable|remolcado|sobre carro|tiro de arrastre)\b/.test(text) && !/\b(orugas)\b/.test(text))
        ) {
            mobility = 'TOWED_TRAILER';
        } else if (/\b(puente grua|portico|riel|ferroviario|locomotora)\b/.test(text)) {
            mobility = 'RAIL_OR_GANTRY';
        } else if (
            isCableShovelOrDragline ||
            /\b(orugas|cadenas|tracked|ctl\b|lokotrack|mobirex|mobicone|mobiscreen|bulldozer|excavadora de cadenas|excavadora hidraulica|pala hidraulica|fresadora sobre orugas|perforadora sobre orugas)\b/.test(
                text
            ) && !/\b(sobre neumaticos|sobre ruedas|wheeled)\b/.test(text)
        ) {
            mobility = 'SELF_PROPELLED_TRACKED';
        } else if (
            isOffRoadMiningHaul ||
            isVocationalServiceVehicle ||
            isRoadOrSiteTruckOrLightVehicle ||
            isEarthmoving ||
            (isSurfaceMillingOrCompaction && !/\b(placa|vibropison|manual)\b/.test(text)) ||
            (isLiftingOrRigging && !/\b(puente grua|polipasto|tecle|winche|estacionari)\b/.test(text)) ||
            (isDrillingOrSupport && /\b(jumbo|simba|boomer|camion|neumaticos|autopropulsad)\b/.test(text))
        ) {
            mobility = 'SELF_PROPELLED_WHEELED';
        }

        // 3. Fuente Primaria de Energía
        let primary_energy: EnergySourceCategory = 'NO_DECLARADO';
        if (isTowedTrailer) {
            primary_energy = 'REMOLCADO_SIN_PROPULSION_PROPIA';
        } else if (/\b(torquimetro manual|tecle manual|llave manual|accionamiento manual|sin energia externa)\b/.test(text)) {
            primary_energy = 'MANUAL_MECANICO';
        } else if (
            /\b(llave de torque hidraulica|hytorc|tensionador hidraulico|cilindro hidraulico|martillo hidraulico|aditamento hidraulico|700 bar|10000 psi|unidad hidraulica externa)\b/.test(
                text
            )
        ) {
            primary_energy = 'HIDRAULICO_AUXILIAR';
        } else if (
            /\b(neumatic[oa]|aire comprimido|jackleg|stoper|yt27|yt28|yt29|llave de impacto neumatica|bomba diafragma neumatica)\b/.test(
                text
            ) &&
            !isPumpOrCompressor &&
            !isRoadOrSiteTruckOrLightVehicle
        ) {
            primary_energy = 'NEUMATICO_AIRE_COMPRIMIDO';
        } else if (
            isAerialRpas ||
            /\b(bateria|ion[\s-]*litio|li[\s-]*ion|lfp\b|nmc\b|bev\b|inalambric[oa]|18v|20v|36v|48v|80v|torre solar|solar fotovoltaica)\b/.test(
                text
            ) && !/\b(diesel|gasolina)\b/.test(text)
        ) {
            primary_energy = 'ELECTRICO_BATERIA_BEV';
        } else if (/\b(hibrid[oa]|diesel[\s-]*electric|e-drive)\b/.test(text)) {
            primary_energy = 'HIBRIDO_DIESEL_ELECTRICO';
        } else if (
            isCableShovelOrDragline ||
            (/\b(trifasic[oa]|monofasic[oa]|electric[oa]|sumergible|electrobomba|grindex|flygt|puente grua|correa transportadora|molino de bolas|molino sag|subestacion|transformador|inversora de soldadura|380v|400v|440v|480v|4160v|6600v|7200v|13800v)\b/.test(
                text
            ) &&
                !/\b(diesel|motosoldadora|motobomba|gasolina|bencin)\b/.test(text))
        ) {
            primary_energy = 'ELECTRICO_RED_AC';
        } else if (/\b(glp\b|gas licuado|gnv\b|gas natural)\b/.test(text)) {
            primary_energy = 'GLP_GNV';
        } else if (/\b(gasolina|bencin[ao]|2 tiempos|4 tiempos gasolina)\b/.test(text)) {
            primary_energy = 'GASOLINA';
        } else if (
            /\b(diesel|petroleo|cummins|cat c|perkins|detroit|mack mp|volvo d1|volvo d13|scania dc|kubota|yanmar|deutz|isuzu|motosoldadora|grupo electrogeno|torre de iluminacion)\b/.test(
                text
            ) ||
            mobility === 'SELF_PROPELLED_TRACKED' ||
            mobility === 'SELF_PROPELLED_WHEELED'
        ) {
            primary_energy = 'DIESEL';
        }

        // 4. Interfaz de Operador (elimina Cabina ROPS falsa en herramientas, drones, bombas y chancadores)
        let operator_interface: OperatorInterfaceTrait = 'LOCAL_PANEL_HMI';
        if (isAerialRpas || /\b(radiocontrol|control remoto|teleoperad|lokotrack|mobirex|mobicone|mobiscreen|robot shotcrete)\b/.test(text)) {
            operator_interface = 'REMOTE_RADIO_OR_GCS';
        } else if (mobility === 'PORTABLE_OR_HANDHELD' || mobility === 'ATTACHMENT_IMPLEMENT') {
            operator_interface = 'DIRECT_HAND_TRIGGER';
        } else if (/\b(hombre caminando|walk[\s-]*behind|botonera colgante|pendant|transpaleta)\b/.test(text)) {
            operator_interface = 'WALK_BEHIND_OR_PENDANT';
        } else if (isVocationalServiceVehicle || isRoadOrSiteTruckOrLightVehicle) {
            operator_interface = 'HIGHWAY_CABIN';
        } else if (
            mobility === 'SELF_PROPELLED_TRACKED' ||
            mobility === 'SELF_PROPELLED_WHEELED'
        ) {
            operator_interface = /\b(canopy abierto|sin cabina|asiento abierto|cuatrimoto)\b/.test(text)
                ? 'OPEN_CANOPY_OR_SEAT'
                : 'ENCLOSED_CABIN_ROPS_FOPS';
        } else {
            operator_interface = 'LOCAL_PANEL_HMI';
        }

        // 5. Régimen de Desplazamiento y Base de Cadencia PM
        let duty_travel_regime: DutyTravelRegimeTrait = 'OFF_ROAD_SITE';
        let pm_cadence_basis: PmCadenceBasisTrait = 'HOROMETER_HOURS';

        if (isAerialRpas) {
            duty_travel_regime = 'FLIGHT_OR_MISSION';
            pm_cadence_basis = 'CYCLES_OR_FLIGHTS';
        } else if (isBoltingOrTool || isMetrologyInstrument) {
            duty_travel_regime = 'STATIONARY_DUTY';
            pm_cadence_basis =
                /\b(torque|torquimetro|hytorc|tensionador|estacion total|gnss|rtk|calibracion|analizador|balanza)\b/.test(
                    text
                )
                    ? 'CALENDAR_AND_METROLOGY'
                    : 'CYCLES_OR_FLIGHTS';
        } else if (isVocationalServiceVehicle || isRoadOrSiteTruckOrLightVehicle) {
            const isPureLightHighway =
                /\b(furgon urbano|sedan|bus interurbano)\b/.test(text) && !/\b(4x4|minera|faena|tolva)\b/.test(text);
            duty_travel_regime = isPureLightHighway ? 'ON_HIGHWAY' : 'DUAL_ROAD_AND_SITE';
            pm_cadence_basis = isPureLightHighway ? 'ODOMETER_KM' : 'DUAL_KM_AND_HOURS';
        } else if (isTowedTrailer) {
            duty_travel_regime = 'DUAL_ROAD_AND_SITE';
            pm_cadence_basis = 'DUAL_KM_AND_HOURS';
        } else if (mobility === 'SKID_STATIONARY' || isLightingTower || isWelder || isGensetOrPower || isPumpOrCompressor) {
            duty_travel_regime = 'STATIONARY_DUTY';
            pm_cadence_basis = 'HOROMETER_HOURS';
        } else {
            duty_travel_regime = 'OFF_ROAD_SITE';
            pm_cadence_basis = 'HOROMETER_HOURS';
        }

        const has_hydraulic_system =
            primary_energy === 'HIDRAULICO_AUXILIAR' ||
            isEarthmoving ||
            isLiftingOrRigging ||
            isDrillingOrSupport ||
            isComminutionOrPlant ||
            isSurfaceMillingOrCompaction ||
            isVocationalServiceVehicle ||
            /\b(hidraulic[oa]|tolva|volquete|hytorc)\b/.test(text);

        const has_compressed_air_system =
            primary_energy === 'NEUMATICO_AIRE_COMPRIMIDO' ||
            /\b(compresor|freno neumatico|frenos de aire|camion|tractocamion|remolque|semirremolque|lubricador|perforadora)\b/.test(
                text
            );

        const requires_metrology_calibration =
            pm_cadence_basis === 'CALENDAR_AND_METROLOGY' ||
            isAerialRpas ||
            /\b(torque|hytorc|calibracion|iso 6789|pesaje|celda de carga|gnss|rtk|lidar|instrumento|analizador)\b/.test(
                text
            );

        // Clase ISO 14224 + Icono Material Symbols Outlined sin emojis ni cajas
        let iso_14224_equipment_class = 'IND-GEN';
        let material_symbol_icon = 'precision_manufacturing';

        if (isAerialRpas) {
            iso_14224_equipment_class = 'RPAS-UAV';
            material_symbol_icon = 'flight';
        } else if (isMetrologyInstrument) {
            iso_14224_equipment_class = 'INST-MET';
            material_symbol_icon = 'straighten';
        } else if (isBoltingOrTool) {
            iso_14224_equipment_class = 'TL-BOLT-PWR';
            material_symbol_icon = 'build';
        } else if (isLightingTower) {
            iso_14224_equipment_class = 'LT-TOWER';
            material_symbol_icon = 'lightbulb';
        } else if (isWelder) {
            iso_14224_equipment_class = 'WLD-ARC';
            material_symbol_icon = 'bolt';
        } else if (isGensetOrPower) {
            iso_14224_equipment_class = 'GEN-PWR';
            material_symbol_icon = 'electrical_services';
        } else if (isPumpOrCompressor) {
            iso_14224_equipment_class = /\b(compresor|soplador)\b/.test(text) ? 'CMP-AIR' : 'PU-IND';
            material_symbol_icon = /\b(compresor|soplador)\b/.test(text) ? 'air' : 'water_pump';
        } else if (isComminutionOrPlant) {
            iso_14224_equipment_class = 'CRU-SCR';
            material_symbol_icon = 'landslide';
        } else if (isCableShovelOrDragline) {
            iso_14224_equipment_class = 'SHV-ELC-CBL';
            material_symbol_icon = 'precision_manufacturing';
        } else if (isDrillingOrSupport) {
            iso_14224_equipment_class = 'DRL-MIN';
            material_symbol_icon = 'hardware';
        } else if (isLiftingOrRigging) {
            iso_14224_equipment_class = 'LFT-CRN';
            material_symbol_icon = 'forklift';
        } else if (isSurfaceMillingOrCompaction) {
            iso_14224_equipment_class = 'SRF-CMP';
            material_symbol_icon = 'road';
        } else if (isVocationalServiceVehicle || isRoadOrSiteTruckOrLightVehicle || isOffRoadMiningHaul) {
            iso_14224_equipment_class = isOffRoadMiningHaul ? 'HAUL-OFFRD' : 'TRK-FLEET';
            material_symbol_icon = 'local_shipping';
        } else if (isTowedTrailer) {
            iso_14224_equipment_class = 'TRL-TOW';
            material_symbol_icon = 'rv_hookup';
        } else if (isEarthmoving) {
            iso_14224_equipment_class = 'EMV-HVY';
            material_symbol_icon = 'front_loader';
        }

        const base: AssetPhysicalTraits = {
            mobility,
            primary_energy,
            operator_interface,
            duty_travel_regime,
            pm_cadence_basis,
            functional_domain,
            has_hydraulic_system,
            has_compressed_air_system,
            requires_metrology_calibration,
            iso_14224_equipment_class,
            material_symbol_icon,
        };

        const existingTraits = input.existing_traits || input.existingTraits;
        if (existingTraits) {
            return {
                ...base,
                ...Object.fromEntries(
                    Object.entries(existingTraits).filter(([, v]) => v !== undefined && v !== null)
                ),
            } as AssetPhysicalTraits;
        }

        return base;
    }

    /**
     * Resuelve la unidad primaria de costo energético (`CostDriverUnit`) según los rasgos físicos del activo.
     */
    static resolveDefaultCostDriverUnit(traits: AssetPhysicalTraits): CostDriverUnit {
        if (traits.primary_energy === 'REMOLCADO_SIN_PROPULSION_PROPIA') return '0 L/h (Remolcado)';
        if (traits.primary_energy === 'MANUAL_MECANICO') return '0 L/h (Manual)';
        if (traits.primary_energy === 'HIDRAULICO_AUXILIAR') return 'bar (700 bar Hidr.)';
        if (traits.primary_energy === 'NEUMATICO_AIRE_COMPRIMIDO') return 'L/s';
        if (traits.primary_energy === 'ELECTRICO_RED_AC') return 'kWh/h';
        if (traits.primary_energy === 'ELECTRICO_BATERIA_BEV') {
            if (traits.pm_cadence_basis === 'CYCLES_OR_FLIGHTS') return 'kWh/ciclo';
            if (traits.duty_travel_regime === 'ON_HIGHWAY' || traits.duty_travel_regime === 'DUAL_ROAD_AND_SITE') {
                return 'kWh/100km';
            }
            return 'kWh/h';
        }
        if (traits.duty_travel_regime === 'ON_HIGHWAY' || traits.duty_travel_regime === 'DUAL_ROAD_AND_SITE') {
            return 'km/L';
        }
        return 'L/h';
    }

    /**
     * Construye dinámicamente la taxonomía y encabezados de la Matriz de Costos (`CostMatrixTaxonomyMeta`)
     * para cualquier tipo de equipo industrial, eliminando enums fijos en el cliente y cualquier residuo
     * de cuchillas/dientes GET en camiones, vehículos, bombas, drones o herramientas.
     */
    static buildDynamicCostMatrixTaxonomy(
        traits: AssetPhysicalTraits,
        canonicalTypeEs?: string
    ): CostMatrixTaxonomyMeta {
        const typeNorm = normalizeOntologyText(canonicalTypeEs || '');
        const label = canonicalTypeEs?.trim() || 'Activo Industrial';

        if (traits.functional_domain === 'BOLTING_TORQUE_AND_TOOLS') {
            return {
                family_key: 'BOLTING_TORQUE_AND_TOOLS',
                family_label_es: `${label} · Herramienta Industrial / Torque`,
                material_icon: traits.material_symbol_icon || 'build',
                wear_section_visible: true,
                wear_section_title_es: 'Elementos de Desgaste Mecánico, Cuadradillo, Trinquete y Sellos de Alta Presión',
                wear_col_1_label_es: 'Componente Mecánico / Kit de Sellos',
                wear_col_2_label_es: 'Mecanismo (Cuadradillo / Brazo de Reacción / Cilindro)',
                wear_empty_hint_es:
                    '[Información técnica no declarada en ficha] — Sin piezas de desgaste o kits de sellos cazados en Pauta de Mantención.',
                support_section_visible: true,
                support_section_title_es: 'Acoples Rápidos, Mangueras Gemelas (700 bar) y Certificación Metrológica',
                support_col_spec_label_es: 'Especificación / Rango Nominal (bar · N·m)',
                support_col_pressure_label_es: 'Presión Máxima / Incertidumbre ISO 6789',
                support_empty_hint_es:
                    '[Información técnica no declarada en ficha] — Sin acoples o mangueras de alta presión declarados.',
                supports_road_km_efficiency: false,
                supports_hourly_load_table: false,
                primary_tco_unit: '$ / ciclo',
                wear_exclude_keywords: ['diente', 'cuchilla', 'balde', 'tolva', 'oruga', 'zapata', 'neumatico'],
            };
        }

        if (traits.functional_domain === 'SURVEY_INSPECTION_RPAS') {
            const isAerial = traits.mobility === 'AERIAL_OR_MARINE';
            return {
                family_key: isAerial ? 'AERIAL_RPAS_SURVEY' : 'METROLOGY_SURVEY_INSTRUMENT',
                family_label_es: `${label} · Geodesia / Inspección`,
                material_icon: traits.material_symbol_icon || (isAerial ? 'flight' : 'straighten'),
                wear_section_visible: true,
                wear_section_title_es: isAerial
                    ? 'Componentes por Ciclos de Vuelo (Hélices, Motores Brushless y Dampers Gimbal)'
                    : 'Accesorios Ópticos, Baterías Recargables y Sellos Ambientales IP',
                wear_col_1_label_es: 'Componente / Consumible por Ciclos',
                wear_col_2_label_es: isAerial ? 'Rotor / Brazo / Gimbal / Payload' : 'Módulo Óptico / Alimentación',
                wear_empty_hint_es:
                    '[Información técnica no declarada en ficha] — Sin componentes por ciclos cazados en Pauta de Mantención.',
                support_section_visible: true,
                support_section_title_es: isAerial
                    ? 'Tren de Aterrizaje, Baterías de Vuelo Inteligentes y Verificación RTK'
                    : 'Trípode, Base Nivelante y Certificación de Calibración',
                support_col_spec_label_es: 'Modelo / Capacidad (Wh · mAh · Ciclos)',
                support_col_pressure_label_es: 'Límite de Ciclos / Vigencia Calibración',
                support_empty_hint_es:
                    '[Información técnica no declarada en ficha] — Sin tren de aterrizaje o bancos de batería declarados.',
                supports_road_km_efficiency: false,
                supports_hourly_load_table: false,
                primary_tco_unit: '$ / ciclo',
                wear_exclude_keywords: ['diente', 'cuchilla', 'balde', 'tolva', 'oruga', 'zapata', 'neumatico'],
            };
        }

        if (traits.functional_domain === 'FLUID_PUMPING_AND_AIR') {
            return {
                family_key: 'FLUID_PUMPING_AND_AIR',
                family_label_es: `${label} · Bombeo y Fluidos / Aire`,
                material_icon: traits.material_symbol_icon || 'water_pump',
                wear_section_visible: true,
                wear_section_title_es: 'Elementos Hidráulicos de Desgaste (Impulsor, Difusor, Camisa y Sellos Mecánicos SiC)',
                wear_col_1_label_es: 'Elemento Húmedo / Sello Mecánico',
                wear_col_2_label_es: 'Cámara Hidráulica / Cabezal Compresor',
                wear_empty_hint_es:
                    '[Información técnica no declarada en ficha] — Sin impulsores, difusores o sellos mecánicos cazados en Pauta de Mantención.',
                support_section_visible: traits.mobility === 'TOWED_TRAILER' || traits.mobility === 'SELF_PROPELLED_WHEELED',
                support_section_title_es: 'Chasis / Skid, Soportes Antivibratorios y Rodado de Remolque',
                support_col_spec_label_es: 'Especificación de Montaje / Neumático',
                support_col_pressure_label_es: 'Presión / Rigidez Nominal',
                support_empty_hint_es:
                    '[Información técnica no declarada en ficha] — Unidad estacionaria o sumergible sin tren de rodado.',
                supports_road_km_efficiency: false,
                supports_hourly_load_table: true,
                primary_tco_unit: '$ / h',
                wear_exclude_keywords: ['diente', 'cuchilla de balde', 'cantonera', 'portadiente', 'ripper'],
            };
        }

        if (traits.functional_domain === 'POWER_GEN_WELDING_LIGHTING') {
            const isWeld = /\b(soldad|motosoldad|arco|tig|mig)\b/.test(typeNorm);
            const isLight = /\b(iluminacion|luminaria|hilight|torre)\b/.test(typeNorm);
            return {
                family_key: isWeld
                    ? 'ARC_WELDING_EQUIPMENT'
                    : isLight
                    ? 'MOBILE_LIGHTING_TOWER'
                    : 'POWER_GENERATION_UNIT',
                family_label_es: `${label} · Energía / Proceso`,
                material_icon: traits.material_symbol_icon || 'bolt',
                wear_section_visible: true,
                wear_section_title_es: isWeld
                    ? 'Consumibles de Antorcha/Proceso (Toberas, Puntas de Contacto, Liners, Rodillos y Escobillas)'
                    : isLight
                    ? 'Módulos Luminosos LED/Haluro, Cable/Winche de Mástil y Estabilizadores'
                    : 'Elementos de Desgaste Electromecánico (Correas, Rodamientos de Alternador, AVR y Soportes)',
                wear_col_1_label_es: 'Consumible / Repuesto Operacional',
                wear_col_2_label_es: isWeld ? 'Antorcha / Alimentador / Generador' : isLight ? 'Mástil / Luminaria' : 'Alternador / Motor',
                wear_empty_hint_es:
                    '[Información técnica no declarada en ficha] — Sin consumibles de proceso cazados en Pauta de Mantención.',
                support_section_visible: true,
                support_section_title_es:
                    traits.mobility === 'TOWED_TRAILER'
                        ? 'Eje de Remolque, Neumáticos, Enganche y Patas Estabilizadoras'
                        : 'Bastidor / Skid y Aisladores Elastómeros Antivibración',
                support_col_spec_label_es: 'Medida de Neumático / Aislador',
                support_col_pressure_label_es: 'Presión en Frío / Torque de Rueda',
                support_empty_hint_es:
                    '[Información técnica no declarada en ficha] — Sin datos de rodado o aisladores cazados en Pauta de Mantención.',
                supports_road_km_efficiency: false,
                supports_hourly_load_table: true,
                primary_tco_unit: '$ / h',
                wear_exclude_keywords: ['diente', 'cuchilla', 'cantonera', 'portadiente', 'ripper', 'balde'],
            };
        }

        if (traits.functional_domain === 'COMMINUTION_AND_SCREENING') {
            return {
                family_key: 'COMMINUTION_AND_SCREENING',
                family_label_es: `${label} · Chancado y Clasificación`,
                material_icon: traits.material_symbol_icon || 'landslide',
                wear_section_visible: true,
                wear_section_title_es: 'Revestimientos de Cámara (Mandíbulas / Mantos / Cóncavos), Mallas, Polines y Correas',
                wear_col_1_label_es: 'Elemento de Desgaste Mineral (Acero Mn / Malla / Correa)',
                wear_col_2_label_es: 'Cámara de Chancado / Harnero / Transportador',
                wear_empty_hint_es:
                    '[Información técnica no declarada en ficha] — Sin revestimientos, mallas o correas cazados en Pauta de Mantención.',
                support_section_visible: true,
                support_section_title_es:
                    traits.mobility === 'SELF_PROPELLED_TRACKED'
                        ? 'Tren de Rodaje sobre Orugas (Zapatas, Cadenas, Rodillos y Mandos)'
                        : 'Estructura Portante, Resortes de Harnero y Apoyos Elastómeros',
                support_col_spec_label_es: 'Especificación de Zapata / Resorte / Apoyo',
                support_col_pressure_label_es: 'Tensión de Cadena / Flecha Nominal',
                support_empty_hint_es:
                    '[Información técnica no declarada en ficha] — Sin componentes de tren de orugas o apoyos declarados.',
                supports_road_km_efficiency: false,
                supports_hourly_load_table: true,
                primary_tco_unit: '$ / h',
            };
        }

        if (traits.functional_domain === 'DRILLING_AND_GROUND_SUPPORT') {
            return {
                family_key: 'DRILLING_AND_GROUND_SUPPORT',
                family_label_es: `${label} · Perforación y Fortificación`,
                material_icon: traits.material_symbol_icon || 'hardware',
                wear_section_visible: true,
                wear_section_title_es: 'Columna de Aceros de Perforación (Brocas/Bits, Barras, Culatines/Shank y Coplas)',
                wear_col_1_label_es: 'Acero de Perforación / Sellos de Martillo',
                wear_col_2_label_es: 'Drifter / Martillo / Viga de Avance',
                wear_empty_hint_es:
                    '[Información técnica no declarada en ficha] — Sin aceros de perforación cazados en Pauta de Mantención.',
                support_section_visible: traits.mobility !== 'PORTABLE_OR_HANDHELD',
                support_section_title_es:
                    traits.mobility === 'SELF_PROPELLED_TRACKED'
                        ? 'Tren de Orugas y Gatos de Nivelación'
                        : 'Neumáticos Mineros y Gatos Hidráulicos de Estabilización',
                support_col_spec_label_es: 'Medida / Compuesto OEM',
                support_col_pressure_label_es: 'Presión / Tensión Nominal',
                support_empty_hint_es:
                    '[Información técnica no declarada en ficha] — Sin tren de rodado aplicable o no declarado.',
                supports_road_km_efficiency: false,
                supports_hourly_load_table: true,
                primary_tco_unit: '$ / h',
                wear_exclude_keywords: ['cuchilla de balde', 'cantonera de balde', 'tolva'],
            };
        }

        if (traits.functional_domain === 'LIFTING_AND_RIGGING') {
            return {
                family_key: 'LIFTING_AND_RIGGING',
                family_label_es: `${label} · Izaje y Manejo de Materiales`,
                material_icon: traits.material_symbol_icon || 'forklift',
                wear_section_visible: true,
                wear_section_title_es: 'Elementos de Izaje y Desgaste (Cables de Acero, Poleas, Almohadillas de Pluma, Horquillas y Frenos)',
                wear_col_1_label_es: 'Cable / Pastilla / Horquilla / Gancho',
                wear_col_2_label_es: 'Pluma / Winche / Mástil / Frenos',
                wear_empty_hint_es:
                    '[Información técnica no declarada en ficha] — Sin cables de izaje, almohadillas o horquillas cazados en Pauta de Mantención.',
                support_section_visible: true,
                support_section_title_es: 'Neumáticos / Ruedas Macizas, Estabilizadores (Outriggers) y Tornamesa de Giro',
                support_col_spec_label_es: 'Medida de Neumático / Cable / Rodamiento Giro',
                support_col_pressure_label_es: 'Presión / Carga Máxima de Apoyo',
                support_empty_hint_es:
                    '[Información técnica no declarada en ficha] — Sin neumáticos o estabilizadores declarados.',
                supports_road_km_efficiency: traits.duty_travel_regime === 'DUAL_ROAD_AND_SITE',
                supports_hourly_load_table: true,
                primary_tco_unit: '$ / h',
                wear_exclude_keywords: ['diente de balde', 'ripper', 'escarificador'],
            };
        }

        if (
            traits.functional_domain === 'HAULAGE_AND_TRANSPORT' ||
            traits.functional_domain === 'VOCATIONAL_SERVICE_SUPPORT'
        ) {
            const isTowed = traits.mobility === 'TOWED_TRAILER';
            const isVocational = traits.functional_domain === 'VOCATIONAL_SERVICE_SUPPORT';
            const isMiningCaex =
                traits.duty_travel_regime === 'OFF_ROAD_SITE' &&
                /\b(caex|extraccion|dumper|articulado|bajo perfil)\b/.test(typeNorm);
            const hasDumpBody = /\b(tolva|volquete|caex|extraccion|dumper|batea)\b/.test(typeNorm);

            return {
                family_key: isTowed
                    ? 'TOWED_TRAILER_CHASSIS'
                    : isVocational
                    ? 'VOCATIONAL_SERVICE_TRUCK'
                    : isMiningCaex
                    ? 'OFF_ROAD_HAUL_TRUCK'
                    : 'ROAD_AND_SITE_FLEET_VEHICLE',
                family_label_es: `${label} · Transporte y Servicio`,
                material_icon: traits.material_symbol_icon || 'local_shipping',
                wear_section_visible: true,
                wear_section_title_es: isVocational
                    ? 'Desgaste de Chasis (Frenos / Embrague) y Bombas / Mangueras / Carretes de Servicio'
                    : hasDumpBody
                    ? 'Frenos de Servicio, Embrague/Transmisión y Revestimiento/Piso de Tolva (Liners)'
                    : 'Elementos de Fricción y Chasis (Pastillas/Balatas, Discos/Tambores, Embrague y Suspensión)',
                wear_col_1_label_es: 'Elemento de Fricción / Chasis / Carrocería',
                wear_col_2_label_es: 'Eje / Frenos / Transmisión / Carrocería',
                wear_empty_hint_es:
                    '[Información técnica no declarada en ficha] — Sin elementos de fricción, frenos o revestimiento de carrocería cazados en Pauta de Mantención.',
                support_section_visible: true,
                support_section_title_es: 'Dotación de Neumáticos (Direccionales, Tracción y Ejes de Carga)',
                support_col_spec_label_es: 'Medida / Índice de Carga / PR o TKPH',
                support_col_pressure_label_es: 'Presión de Inflado en Frío (psi / bar)',
                support_empty_hint_es:
                    '[Información técnica no declarada en ficha] — Sin medidas ni presiones de neumáticos cazadas en Pauta de Mantención.',
                supports_road_km_efficiency: !isTowed && !isMiningCaex,
                supports_hourly_load_table: !isTowed,
                primary_tco_unit: isTowed
                    ? '$ / km'
                    : isMiningCaex
                    ? '$ / h'
                    : isVocational
                    ? '$ / km + $ / h (PTO)'
                    : '$ / km',
                // Exclusión determinista anti-contaminación: un camión o camioneta NUNCA tiene cuchillas, dientes ni ripper
                wear_exclude_keywords: [
                    'diente',
                    'portadiente',
                    'cuchilla',
                    'cantonera',
                    'labio de balde',
                    'ripper',
                    'escarificador',
                    'pica de corte',
                ],
            };
        }

        if (traits.functional_domain === 'SURFACE_MILLING_COMPACTION') {
            const isMilling = /\b(fresadora|recicladora|pavimentadora)\b/.test(typeNorm);
            return {
                family_key: 'SURFACE_MILLING_COMPACTION',
                family_label_es: `${label} · Superficie y Compactación`,
                material_icon: traits.material_symbol_icon || 'road',
                wear_section_visible: true,
                wear_section_title_es: isMilling
                    ? 'Herramientas de Corte Vial (Picas de Carburo, Portapicas, Placas de Tambor y Cinta)'
                    : 'Raspadores de Tambor, Aisladores Elastómeros de Vibración y Placa Base',
                wear_col_1_label_es: 'Pica / Raspador / Aislador de Vibración',
                wear_col_2_label_es: 'Tambor / Regla / Banda de Descarga',
                wear_empty_hint_es:
                    '[Información técnica no declarada en ficha] — Sin picas, raspadores o aisladores cazados en Pauta de Mantención.',
                support_section_visible: traits.mobility !== 'PORTABLE_OR_HANDHELD',
                support_section_title_es:
                    traits.mobility === 'SELF_PROPELLED_TRACKED'
                        ? 'Orugas con Zapatas de Poliuretano/Acero y Rodillos'
                        : 'Neumáticos de Tracción y Tambor Metálico',
                support_col_spec_label_es: 'Medida de Zapata / Neumático',
                support_col_pressure_label_es: 'Tensión / Presión Nominal',
                support_empty_hint_es:
                    '[Información técnica no declarada en ficha] — Sin rodado aplicable o no declarado.',
                supports_road_km_efficiency: false,
                supports_hourly_load_table: true,
                primary_tco_unit: '$ / h',
            };
        }

        if (traits.functional_domain === 'EARTHMOVING_EXCAVATION') {
            const isCableShovel = traits.iso_14224_equipment_class === 'SHV-ELC-CBL';
            return {
                family_key: isCableShovel
                    ? 'ELECTRIC_CABLE_SHOVEL'
                    : traits.mobility === 'SELF_PROPELLED_TRACKED'
                    ? 'TRACKED_EARTHMOVING_GET'
                    : 'WHEELED_EARTHMOVING_GET',
                family_label_es: `${label} · Excavación y Movimiento de Tierra`,
                material_icon: traits.material_symbol_icon || 'front_loader',
                wear_section_visible: true,
                wear_section_title_es: isCableShovel
                    ? 'Elementos GET de Dipper (Dientes, Labio, Adaptadores) y Cables de Acero (Hoist / Crowd / Trip)'
                    : 'Elementos de Desgaste de Ataque al Suelo (GET: Dientes, Cuchillas, Cantoneras y Ripper)',
                wear_col_1_label_es: isCableShovel ? 'Elemento GET / Cable de Izaje-Empuje' : 'Elemento GET (Diente / Cuchilla / Cantonera)',
                wear_col_2_label_es: isCableShovel ? 'Dipper / Pluma / Tambor Hoist-Crowd' : 'Balde / Hoja / Ripper',
                wear_empty_hint_es:
                    '[Información técnica no declarada en ficha] — Sin elementos GET cazados en Pauta de Mantención.',
                support_section_visible: true,
                support_section_title_es:
                    traits.mobility === 'SELF_PROPELLED_TRACKED'
                        ? 'Tren de Rodaje sobre Orugas (Zapatas, Cadenas, Rodillos, Rueda Guía y Sprocket)'
                        : 'Dotación de Neumáticos OTR / Industriales',
                support_col_spec_label_es:
                    traits.mobility === 'SELF_PROPELLED_TRACKED'
                        ? 'Ancho de Zapata / Paso de Cadena'
                        : 'Medida OTR / Compuesto / Nivel L-TRA',
                support_col_pressure_label_es:
                    traits.mobility === 'SELF_PROPELLED_TRACKED'
                        ? 'Comba / Tensión Hidráulica de Cadena'
                        : 'Presión de Inflado en Frío (psi / bar)',
                support_empty_hint_es:
                    '[Información técnica no declarada en ficha] — Sin datos de rodado cazados en Pauta de Mantención.',
                supports_road_km_efficiency: false,
                supports_hourly_load_table: true,
                primary_tco_unit: '$ / h',
            };
        }

        // Dominio Industrial Abierto (nunca fuerza Dientes GET ni Neumáticos OTR)
        return {
            family_key: 'INDUSTRIAL_GENERAL_OPEN',
            family_label_es: label,
            material_icon: traits.material_symbol_icon || 'precision_manufacturing',
            wear_section_visible: true,
            wear_section_title_es: `Piezas de Desgaste Operacional y Consumibles (${label})`,
            wear_col_1_label_es: 'Pieza de Desgaste / Consumible',
            wear_col_2_label_es: 'Subsistema Funcional',
            wear_empty_hint_es:
                '[Información técnica no declarada en ficha] — Sin piezas de desgaste declaradas en Pauta de Mantención.',
            support_section_visible:
                traits.mobility === 'SELF_PROPELLED_WHEELED' ||
                traits.mobility === 'SELF_PROPELLED_TRACKED' ||
                traits.mobility === 'TOWED_TRAILER',
            support_section_title_es: 'Sistema de Rodado, Apoyo o Montaje Estructural',
            support_col_spec_label_es: 'Especificación OEM',
            support_col_pressure_label_es: 'Presión / Tensión / Torque Nominal',
            support_empty_hint_es:
                '[Información técnica no declarada en ficha] — Sin sistema de rodado o apoyo declarado.',
            supports_road_km_efficiency:
                traits.duty_travel_regime === 'ON_HIGHWAY' || traits.duty_travel_regime === 'DUAL_ROAD_AND_SITE',
            supports_hourly_load_table:
                traits.primary_energy !== 'MANUAL_MECANICO' &&
                traits.primary_energy !== 'REMOLCADO_SIN_PROPULSION_PROPIA',
            primary_tco_unit:
                traits.pm_cadence_basis === 'CALENDAR_AND_METROLOGY'
                    ? '$ / mes'
                    : traits.pm_cadence_basis === 'CYCLES_OR_FLIGHTS'
                    ? '$ / ciclo'
                    : '$ / h',
            wear_exclude_keywords: ['diente de balde', 'cuchilla de balde', 'ripper'],
        };
    }

    /**
     * Construye el capítulo núcleo de Consumos y Matriz Energética en Ficha Técnica (`Pilar 01`)
     * estrictamente acorde a `primary_energy` y `duty_travel_regime` (jamás inyecta Diésel/AdBlue a equipos eléctricos/hidráulicos/batería).
     */
    static buildConsumptionCoreChapter(traits: AssetPhysicalTraits): EquipmentTypeCoreChapterItem {
        if (traits.primary_energy === 'REMOLCADO_SIN_PROPULSION_PROPIA') {
            return {
                chapter_key: 'matriz_energetica_consumos_y_autonomia',
                title_es: 'Condición Remolcada (0 L/h Tracción Propia), Suministro Auxiliar (12V/24V/Aire) y Capacidad Útil',
                section_es: 'ENERGÍA AUXILIAR, CAPACIDAD DE SUMINISTRO Y AUTONOMÍA',
                rationale_es:
                    'Detalla la condición no autopropulsada (0 L/h de tracción propia), requerimientos de acoplamiento eléctrico/neumático al vehículo tractor (12V/24V DC, presión de líneas de freno bar/psi), consumo de bombas auxiliares embarcadas si existen y capacidad volumétrica/másica útil.',
                priority: 'CRÍTICO',
            };
        }

        if (traits.primary_energy === 'MANUAL_MECANICO') {
            return {
                chapter_key: 'matriz_energetica_consumos_y_autonomia',
                title_es: 'Accionamiento Mecánico Manual, Fuerza de Entrada Máxima y Relación de Multiplicación',
                section_es: 'ACCIONAMIENTO MECÁNICO Y RENDIMIENTO',
                rationale_es:
                    'Detalla esfuerzo manual máximo admisible en palanca/volante (N), relación de multiplicación mecánica, rendimiento de transmisión y límites de sobrecarga.',
                priority: 'CRÍTICO',
            };
        }

        if (traits.primary_energy === 'HIDRAULICO_AUXILIAR') {
            return {
                chapter_key: 'matriz_energetica_consumos_y_autonomia',
                title_es: 'Requerimiento de Unidad Hidráulica Externa: Presión Nominal (bar/psi), Caudal (L/min) y Curva Presión-Torque/Fuerza',
                section_es: 'SUMINISTRO HIDRÁULICO DE ALTA PRESIÓN Y CONSUMOS',
                rationale_es:
                    'Detalla el suministro requerido desde bomba/central hidráulica externa: presión máxima y de retorno (ej. 700 bar / 10.000 psi), caudal requerido (L/min), volumen desplazado por ciclo (cm³), grado de aceite hidráulico ISO VG y tabla/curva oficial de conversión Presión (bar/psi) vs Torque/Fuerza de salida (N·m / kN).',
                priority: 'CRÍTICO',
            };
        }

        if (traits.primary_energy === 'NEUMATICO_AIRE_COMPRIMIDO') {
            return {
                chapter_key: 'matriz_energetica_consumos_y_autonomia',
                title_es: 'Demanda de Aire Comprimido (L/s · CFM), Presión de Trabajo (bar) y Consumo de Lubricación de Línea',
                section_es: 'CONSUMOS DE AIRE COMPRIMIDO Y FLUIDOS DE LÍNEA',
                rationale_es:
                    'Detalla el caudal nominal de aire comprimido (L/s, m³/min, CFM) a presión efectiva de trabajo (bar / MPa), diámetro mínimo de manguera, consumo de aceite de lubricador en línea (mL/h) y caudal/presión de agua de barrido cuando el equipo lo incorpore.',
                priority: 'CRÍTICO',
            };
        }

        if (traits.primary_energy === 'ELECTRICO_RED_AC') {
            return {
                chapter_key: 'matriz_energetica_consumos_y_autonomia',
                title_es: 'Alimentación Eléctrica Nominal (V/kV · Hz · Fases), Potencia Absorbida (kW/kVA) y Consumo Horario (kWh/h)',
                section_es: 'CONSUMOS DE ENERGÍA ELÉCTRICA Y DEMANDA DE POTENCIA',
                rationale_es:
                    'Detalla tensión nominal y tolerancia (V o kV en media tensión), número de fases y frecuencia (50/60 Hz), corriente nominal y de partida (A), factor de potencia (cos φ), potencia instalada/absorbida (kW / kVA) y consumo energético horario o específico por carga (kWh/h, kWh/t o kWh/m³).',
                priority: 'CRÍTICO',
            };
        }

        if (traits.primary_energy === 'ELECTRICO_BATERIA_BEV') {
            const isFlightOrCycle = traits.pm_cadence_basis === 'CYCLES_OR_FLIGHTS';
            return {
                chapter_key: 'matriz_energetica_consumos_y_autonomia',
                title_es: isFlightOrCycle
                    ? 'Capacidad de Baterías (Wh · mAh), Autonomía por Vuelo/Ciclo, Tiempos de Carga y Vida Útil en Ciclos'
                    : 'Arquitectura de Baterías (kWh · V DC), Consumo Energético (kWh/h · kWh/100 km), Recarga y Autonomía',
                section_es: 'ENERGÍA EN BATERÍAS, RECARGA Y AUTONOMÍA OPERATIVA',
                rationale_es: isFlightOrCycle
                    ? 'Detalla química y modelo de baterías inteligentes, energía nominal (Wh) y capacidad (mAh), tensión (V), consumo energético por misión/ciclo, autonomía máxima en vuelo estacionario y traslación (min), rango térmico de operación/carga (°C), potencia del cargador y vida útil garantizada en ciclos.'
                    : 'Detalla química de celdas (LFP/NMC/Plomo-Ácido), capacidad total y útil (kWh / Ah), consumo energético por factor de carga o ruta (kWh/h o kWh/100 km), potencia de carga AC/DC (kW), frenado regenerativo y autonomía efectiva por carga completa.',
                priority: 'CRÍTICO',
            };
        }

        if (traits.duty_travel_regime === 'ON_HIGHWAY' || traits.duty_travel_regime === 'DUAL_ROAD_AND_SITE') {
            return {
                chapter_key: 'matriz_energetica_consumos_y_autonomia',
                title_es: 'Consumos de Combustible (Por Kilómetro en Ruta/Faena y Por Hora PTO/Ralentí), Eficiencia y Autonomía',
                section_es: 'CONSUMOS DE COMBUSTIBLE, RENDIMIENTO VIAL Y AUTONOMÍA',
                rationale_es:
                    'Detalla tipo de combustible, rendimiento por kilómetro en Carretera Pavimentada (km/L y L/100 km) y Fuera de Carretera / Faena (km/L y L/100 km) para cálculo entre puntos de entrega, consumo horario en ralentí y toma de fuerza PTO (L/h), BSFC (g/kWh), capacidad de estanque de combustible (L), autonomía nominal (km y h), y dosificación SCR (DEF/AdBlue) únicamente cuando la motorización específica lo equipe físicamente (omitiendo por completo toda fila o mención a SCR/DEF cuando no lo posea).',
                priority: 'CRÍTICO',
            };
        }

        return {
            chapter_key: 'matriz_energetica_consumos_y_autonomia',
            title_es: 'Consumos Horarios por Factor de Carga (Bajo/Medio/Alto), Consumo Específico y Autonomía Nominal',
            section_es: 'CONSUMOS DE COMBUSTIBLE, ENERGÍA Y AUTONOMÍA',
            rationale_es:
                'Detalla fuente de energía primaria, consumo horario en ralentí y bajo factor de carga bajo (25-35%), medio (50-65%) y alto (80-100%) en L/h (y kWh/h en híbridos), consumo específico BSFC (g/kWh), capacidad utilizable de estanque de combustible (L), autonomía nominal por carga de estanque (h) y dosificación DEF/AdBlue únicamente cuando la motorización incorpore físicamente sistema SCR (omitiéndolo por completo si no lo posee).',
            priority: 'CRÍTICO',
        };
    }

    /**
     * Construye el capítulo núcleo de Desgaste y Rodado/Apoyo en Pauta de Mantención (`Pilar 03`)
     * en total coherencia con `CostMatrixTaxonomyMeta`.
     */
    static buildWearAndSupportCoreChapter(
        traits: AssetPhysicalTraits,
        canonicalTypeEs?: string
    ): EquipmentTypeCoreChapterItem {
        const tax = this.buildDynamicCostMatrixTaxonomy(traits, canonicalTypeEs);
        return {
            chapter_key: 'etapa_5_recambio_elementos_desgaste_get_y_rodado',
            title_es: tax.support_section_visible
                ? `Recambio de ${tax.wear_section_title_es} y ${tax.support_section_title_es}`
                : `Recambio e Inspección de ${tax.wear_section_title_es}`,
            section_es: 'ELEMENTOS DE DESGASTE, APOYO Y CONSUMIBLES OPERACIONALES',
            rationale_es: `Especifica exclusivamente para ${canonicalTypeEs || 'este activo'} los componentes reales de "${tax.wear_section_title_es}"${
                tax.support_section_visible ? ` y "${tax.support_section_title_es}"` : ''
            }: códigos o medidas OEM, cantidades instaladas, límites dimensionales o de ciclos para condena/reemplazo, presiones/tensiones/torques nominales y vida útil referencial verificable.`,
            priority: 'CRÍTICO',
        };
    }

    /**
     * Genera de forma composicional el Blueprint de 2 Anillos (`core_chapters` + `conditional_subsystems`)
     * para cualquiera de los 5 Pilares de cualquier activo industrial sin caer jamás en fallbacks de excavadora.
     */
    static buildCompositionalPillarBlueprint(
        pillarId: PillarId,
        typeDoc: Pick<
            GlobalEquipmentTypeDoc,
            | 'type_key'
            | 'canonical_type_es'
            | 'categoria_equipo'
            | 'archetype_id'
            | 'spec_schema'
            | 'physical_traits'
        >
    ): EquipmentTypePillarBlueprint {
        const traits = this.inferAssetPhysicalTraits({
            type_key: typeDoc.type_key,
            canonical_type_es: typeDoc.canonical_type_es,
            categoria_equipo: typeDoc.categoria_equipo,
            archetype_id: typeDoc.archetype_id,
            spec_schema: typeDoc.spec_schema,
            existing_traits: typeDoc.physical_traits,
        });

        const label = typeDoc.canonical_type_es || 'Activo Industrial';
        const axesLabels = (typeDoc.spec_schema || [])
            .map((a) => `${a.label_es}${a.unit_si ? ` [${a.unit_si}]` : ''}`)
            .join(', ');

        if (pillarId === 'ficha_tecnica') {
            return this.buildPillar01SpecBlueprint(traits, label, axesLabels);
        }
        if (pillarId === 'manual_operaciones') {
            return this.buildPillar02OperationsBlueprint(traits, label);
        }
        if (pillarId === 'pauta_mantencion') {
            return this.buildPillar03MaintenanceBlueprint(traits, label);
        }
        if (pillarId === 'matriz_riesgos') {
            return this.buildPillar04RiskBlueprint(traits, label);
        }
        return this.buildPillar05PreOpChecklistBlueprint(traits, label);
    }

    private static buildPillar01SpecBlueprint(
        traits: AssetPhysicalTraits,
        label: string,
        axesLabels: string
    ): EquipmentTypePillarBlueprint {
        const core: EquipmentTypeCoreChapterItem[] = [
            {
                chapter_key: 'parametros_nominales_si',
                title_es: `Parámetros Críticos y Capacidades Nominales SI (${label})`,
                section_es: 'DESEMPEÑO NOMINAL Y EJES DIFERENCIADORES',
                rationale_es: `Consolida las magnitudes físicas diferenciadoras verificadas del tipo ${label}: ${
                    axesLabels || 'capacidad principal, potencia/energía y masa operativa'
                }.`,
                priority: 'CRÍTICO',
            },
        ];

        // Planta motriz / fuente de potencia solo cuando corresponde físicamente
        if (
            traits.primary_energy === 'DIESEL' ||
            traits.primary_energy === 'GASOLINA' ||
            traits.primary_energy === 'GLP_GNV' ||
            traits.primary_energy === 'HIBRIDO_DIESEL_ELECTRICO' ||
            traits.primary_energy === 'DUAL_FUEL_DIESEL_GAS'
        ) {
            core.push({
                chapter_key: 'planta_motriz_termica',
                title_es: 'Motorización Térmica, Cilindrada, Curvas de Potencia/Torque y Norma de Emisiones',
                section_es: 'PLANTA MOTRIZ',
                rationale_es:
                    'Modelo exacto de motor, número de cilindros, cilindrada (L), aspiración, potencia bruta y neta en kW (HP), par máximo en N·m @ rpm, norma de emisiones real y altitud máxima sin derateo.',
                priority: 'CRÍTICO',
            });
        } else if (traits.primary_energy === 'ELECTRICO_RED_AC') {
            core.push({
                chapter_key: 'planta_motriz_electrica_ac',
                title_es: 'Motorización / Transformación Eléctrica AC, Aislamiento, Grado IP y Protecciones',
                section_es: 'PLANTA ELÉCTRICA PRINCIPAL',
                rationale_es:
                    'Potencia nominal (kW/kVA), tensión/frecuencia, velocidad síncrona/nominal (rpm), clase de aislamiento térmico (F/H), grado de protección IP/NEMA, método de arranque (VFD/estrella-triángulo/directo) y protecciones térmicas/humedad.',
                priority: 'CRÍTICO',
            });
        } else if (traits.primary_energy === 'ELECTRICO_BATERIA_BEV') {
            core.push({
                chapter_key: 'sistema_propulsion_electrico_bev',
                title_es:
                    traits.mobility === 'AERIAL_OR_MARINE'
                        ? 'Propulsión Brushless, Controladores ESC, Sensores de Navegación RTK/IMU y Enlace RF'
                        : 'Propulsión Eléctrica a Baterías, Inversores, Gestión Térmica BMS y Cargador',
                section_es: 'ARQUITECTURA ELÉCTRICA Y PROPULSIÓN',
                rationale_es:
                    traits.mobility === 'AERIAL_OR_MARINE'
                        ? 'Empuje máximo por rotor, motores brushless, redundancia IMU/barómetro/GNSS RTK (precisión horizontal/vertical cm + ppm), bandas de frecuencia RF (GHz), potencia EIRP (dBm) y clasificación IP.'
                        : 'Motores eléctricos de tracción/trabajo (kW, N·m), sistema BMS, tensión de bus DC y cargador.',
                priority: 'CRÍTICO',
            });
        }

        core.push(this.buildConsumptionCoreChapter(traits));

        // Unidad funcional específica por dominio
        core.push(this.buildDomainWorkSystemSpecChapter(traits, label));

        // Movilidad / transmisión / chasis solo si se desplaza sobre ruedas, orugas o rieles
        if (
            traits.mobility === 'SELF_PROPELLED_WHEELED' ||
            traits.mobility === 'SELF_PROPELLED_TRACKED' ||
            traits.mobility === 'TOWED_TRAILER' ||
            traits.mobility === 'RAIL_OR_GANTRY'
        ) {
            core.push({
                chapter_key: 'tren_rodaje_frenos_y_chasis',
                title_es:
                    traits.mobility === 'SELF_PROPELLED_TRACKED'
                        ? 'Transmisión de Traslación, Mandos Finales, Frenos y Bastidor de Orugas'
                        : traits.mobility === 'TOWED_TRAILER'
                        ? 'Chasis Estructural, Ejes, Suspensión, Enganche y Sistema de Frenos de Remolque'
                        : 'Transmisión, Ejes/Diferenciales, Suspensión, Dirección, Frenos y Neumáticos',
                section_es: 'TREN DE RODAJE, CHASIS Y FRENADO',
                rationale_es:
                    'Especificaciones verificadas de transmisión/traslación, velocidades de desplazamiento, pendientes superables, arquitectura de frenos de servicio/estacionamiento/retardo y medidas de rodado.',
                priority: 'CRÍTICO',
            });
        }

        core.push({
            chapter_key: 'geometria_masas_ e_interfaz',
            title_es:
                traits.mobility === 'PORTABLE_OR_HANDHELD'
                    ? 'Dimensiones de Envolvente, Radio de Operación/Acceso, Peso de Herramienta y Ergonomía'
                    : 'Dimensiones Generales, Masas Operativas/Transporte e Interfaz de Control',
            section_es: 'GEOMETRÍA, MASAS E INTERFAZ',
            rationale_es: `Cotas dimensionales en mm/m, masa seca y operativa en kg/t, capacidades de fluidos de servicio (si aplican) y arquitectura de interfaz (${this.describeOperatorInterfaceEs(
                traits.operator_interface
            )}).`,
            priority: 'IMPORTANTE',
        });

        core.push({
            chapter_key: 'valorizacion_capex_vida_economica_y_depreciacion',
            title_es: 'Valorización Referencial (CAPEX), Vida Económica y Base de Depreciación',
            section_es: 'VALORIZACIÓN PATRIMONIAL Y VIDA ECONÓMICA',
            rationale_es:
                'Costo referencial de reposición como unidad nueva (USD/CLP, condición y año), vida económica nominal (h, km, ciclos o años), valor residual (%) y base de depreciación para cálculo TCO.',
            priority: 'CRÍTICO',
        });

        const conditional: EquipmentTypeConditionalSubsystemItem[] = [];
        if (traits.has_hydraulic_system && traits.primary_energy !== 'HIDRAULICO_AUXILIAR') {
            conditional.push({
                subsystem_key: 'circuito_hidraulico_auxiliar',
                title_es: 'Sistema Hidráulico Principal / Auxiliar (Bombas, Caudal L/min y Presión de Alivio bar)',
                section_es: 'HIDRÁULICA',
                rationale_es: 'Tipo de bombas, caudal máximo, presión de trabajo y filtración hidráulica cuando el modelo lo equipa.',
                trigger_keywords: ['bomba hidraulica', 'caudal hidraulico', 'presion de alivio', 'l/min', 'bar'],
                activation_rule: 'EVIDENCE_PRESENT',
            });
        }
        if (traits.requires_metrology_calibration) {
            conditional.push({
                subsystem_key: 'exactitud_metrologica_certificacion',
                title_es: 'Exactitud Metrológica, Repetibilidad y Norma de Certificación de Fábrica',
                section_es: 'METROLOGÍA Y PRECISIÓN',
                rationale_es: 'Tolerancia porcentual (±%), incertidumbre expandida y norma internacional de calibración (ej. ISO 6789 / ISO 17123).',
                trigger_keywords: ['iso 6789', 'exactitud', 'incertidumbre', 'repetibilidad', 'calibracion', 'rtk'],
                activation_rule: 'EVIDENCE_PRESENT',
            });
        }

        return { core_chapters: core, conditional_subsystems: conditional };
    }

    private static buildDomainWorkSystemSpecChapter(
        traits: AssetPhysicalTraits,
        label: string
    ): EquipmentTypeCoreChapterItem {
        switch (traits.functional_domain) {
            case 'BOLTING_TORQUE_AND_TOOLS':
                return {
                    chapter_key: 'rango_torque_cuadradillo_y_reaccion',
                    title_es: 'Rango de Torque/Fuerza (N·m · ft·lbf), Cuadradillo/Hexágono, Precisión (±%) y Brazo de Reacción',
                    section_es: 'DESEMPEÑO MECÁNICO DE EMPERNADO / HERRAMIENTA',
                    rationale_es:
                        'Rango mínimo y máximo de torque o fuerza (N·m / kN), medida de cuadradillo de mando (in) o casete hexagonal (mm), ángulo por carrera, exactitud/repetibilidad (±%) y geometría de reacción.',
                    priority: 'CRÍTICO',
                };
            case 'SURVEY_INSPECTION_RPAS':
                return {
                    chapter_key: 'payload_sensores_y_envolvente_mision',
                    title_es: 'Capacidad de Payload, Sensores/Cámaras Admitidas, Precisión Geodésica y Envolvente Ambiental',
                    section_es: 'SISTEMA DE MISIÓN, SENSORES Y PRECISIÓN',
                    rationale_es:
                        'Carga útil máxima (g/kg), puertos de gimbal/montaje, resolución óptica/térmica/LiDAR (MPx, pts/s), resistencia máxima al viento (m/s), techo de servicio (m s.n.m.) y rango de temperatura.',
                    priority: 'CRÍTICO',
                };
            case 'FLUID_PUMPING_AND_AIR':
                return {
                    chapter_key: 'curva_hidraulica_o_neumatica_proceso',
                    title_es: 'Curva de Desempeño (Altura Dinámica m.c.a. / Presión bar vs Caudal L/s · m³/h), Paso de Sólidos y Materiales',
                    section_es: 'DESEMPEÑO HIDRÁULICO / NEUMÁTICO DE PROCESO',
                    rationale_es:
                        'Caudal máximo y en punto óptimo BEP (L/s, m³/h o CFM), altura manométrica máxima (m.c.a.) o presión de descarga (bar), diámetro de descarga (in/mm), paso máximo de sólidos (mm), pH admisible y metalurgia de impulsor/sellos.',
                    priority: 'CRÍTICO',
                };
            case 'POWER_GEN_WELDING_LIGHTING':
                return {
                    chapter_key: 'capacidad_salida_proceso_energia',
                    title_es: 'Salida Nominal de Proceso (Potencia Prime/Standby kVA · Corriente de Soldadura A/% Ciclo · Flujo Luminoso lm)',
                    section_es: 'DESEMPEÑO DE SALIDA DE PROCESO',
                    rationale_es:
                        'Parámetros nominales verificables del proceso: potencia Prime/Standby (kVA/kW), rango de corriente/tensión de arco (A/V) con ciclo de trabajo (%) a 40 °C, o flujo luminoso total (lm), cobertura (lux/m²) y altura/resistencia al viento del mástil.',
                    priority: 'CRÍTICO',
                };
            case 'COMMINUTION_AND_SCREENING':
                return {
                    chapter_key: 'camara_conminucion_css_y_capacidad',
                    title_es: 'Cámara de Chancado/Clasificación, Abertura de Admisión, Rango CSS (mm) y Capacidad (t/h)',
                    section_es: 'UNIDAD DE PROCESO MINERAL',
                    rationale_es:
                        'Dimensiones de boca/harnero (mm), tamaño máximo de alimentación, rango de reglaje lado cerrado CSS (mm), accionamiento de cámara, capacidad de procesamiento (t/h) y alturas de descarga de transportadores.',
                    priority: 'CRÍTICO',
                };
            case 'DRILLING_AND_GROUND_SUPPORT':
                return {
                    chapter_key: 'unidad_perforacion_impacto_y_barrido',
                    title_es: 'Unidad de Perforación / Martillo: Energía y Frecuencia de Impacto (kW · Hz), Rango de Diámetros y Viga',
                    section_es: 'SISTEMA DE PERFORACIÓN Y AVANCE',
                    rationale_es:
                        'Modelo de perforadora/drifter, potencia de percusión (kW), frecuencia (Hz), par de rotación (N·m), rango de diámetros de perforación (mm), longitud de barras/avance y sistema de barrido.',
                    priority: 'CRÍTICO',
                };
            case 'LIFTING_AND_RIGGING':
                return {
                    chapter_key: 'capacidad_izaje_diagrama_carga_y_alcance',
                    title_es: 'Capacidad Nominal de Izaje (t/kg), Altura/Alcance Máximo (m), Momento de Carga y Estabilización',
                    section_es: 'DESEMPEÑO DE IZAJE Y ESTABILIDAD',
                    rationale_es:
                        'Carga máxima nominal y en alcance máximo, longitud de pluma/mástil, velocidades de izaje/giro y envergadura de estabilizadores.',
                    priority: 'CRÍTICO',
                };
            case 'VOCATIONAL_SERVICE_SUPPORT':
                return {
                    chapter_key: 'equipamiento_carrozado_servicio',
                    title_es: 'Módulo Carrozado de Servicio: Estanques Compartimentados, Bombas de Despacho, Caudales y Filtración',
                    section_es: 'EQUIPAMIENTO VOCACIONAL DE SERVICIO',
                    rationale_es:
                        'Capacidades volumétricas por compartimento (L/m³), accionamiento PTO/hidráulico/neumático, bombas de trasvasije, carretes retráctiles, cuenta-litros y microfiltración.',
                    priority: 'CRÍTICO',
                };
            default:
                return {
                    chapter_key: 'sistema_trabajo_y_capacidad_operativa',
                    title_es: `Sistema Principal de Trabajo, Capacidades y Fuerzas Operativas (${label})`,
                    section_es: 'SISTEMA DE TRABAJO',
                    rationale_es:
                        'Capacidad volumétrica o másica nominal (m³ / t), cinemática/alcances de trabajo, fuerzas operativas (kN) y equipamiento estándar.',
                    priority: 'CRÍTICO',
                };
        }
    }

    private static buildPillar02OperationsBlueprint(
        traits: AssetPhysicalTraits,
        label: string
    ): EquipmentTypePillarBlueprint {
        const ifaceLabel = this.describeOperatorInterfaceEs(traits.operator_interface);
        const core: EquipmentTypeCoreChapterItem[] = [
            {
                chapter_key: 'interfaz_mandos_e_instrumentacion',
                title_es: `Reconocimiento de ${ifaceLabel}, Indicadores, Alertas y Parada de Emergencia`,
                section_es: 'INTERFAZ DE MANDO Y CONTROL',
                rationale_es: `Identificación funcional de todos los mandos, selectores, indicadores luminosos/digitales y dispositivos de corte de emergencia propios de ${label}.`,
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'puesta_en_marcha_y_verificacion_funcional',
                title_es:
                    traits.primary_energy === 'HIDRAULICO_AUXILIAR'
                        ? 'Conexión de Mangueras de Alta Presión, Purga de Aire, Ajuste de Presión Objetivo y Prueba en Vacío'
                        : traits.primary_energy === 'ELECTRICO_RED_AC'
                        ? 'Verificación de Alimentación Eléctrica/Sentido de Giro, Energización Segura y Partida Controlada'
                        : traits.mobility === 'AERIAL_OR_MARINE'
                        ? 'Configuración de Estación Terrena (GCS), Enlace RTK/GNSS, Chequeo Pre-Vuelo e Inicio de Motores'
                        : 'Secuencia de Encendido / Energización, Estabilización Térmica/Presiones y Pruebas Funcionales',
                section_es: 'PUESTA EN SERVICIO',
                rationale_es: `Procedimiento secuencial OEM antes de aplicar carga de trabajo sobre ${label}.`,
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'tecnica_operacion_nominal_y_limites',
                title_es: `Procedimiento de Operación Nominal, Ciclo Productivo y Límites Operacionales (${label})`,
                section_es: 'OPERACIÓN DE TRABAJO',
                rationale_es:
                    'Técnica correcta de ejecución del trabajo, parámetros admisibles de operación continua y maniobras estrictamente prohibidas por el fabricante.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'detencion_desenergizacion_y_resguardo',
                title_es: 'Secuencia de Detención Normal, Alivio de Energía Residual, Transporte y Almacenamiento',
                section_es: 'DETENCIÓN Y TRANSPORTE',
                rationale_es:
                    'Procedimiento seguro de parada, despresurización/enfriamiento, aseguramiento para traslado o estiba y condiciones de resguardo.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'respuesta_anomalias_y_emergencias',
                title_es: 'Actuación ante Alarmas Críticas, Sobrecarga, Pérdida de Suministro o Emergencia Operativa',
                section_es: 'CONTINGENCIAS OPERATIVAS',
                rationale_es:
                    'Acciones inmediatas del operador ante fallas de presión/temperatura/aislamiento, atasco mecánico, pérdida de enlace o emergencia.',
                priority: 'CRÍTICO',
            },
        ];

        return { core_chapters: core, conditional_subsystems: [] };
    }

    private static buildPillar03MaintenanceBlueprint(
        traits: AssetPhysicalTraits,
        label: string
    ): EquipmentTypePillarBlueprint {
        const cadenceTitle =
            traits.pm_cadence_basis === 'CALENDAR_AND_METROLOGY'
                ? 'Inspección Post-Uso, Limpieza, Lubricación de Mecanismos y Verificación Metrológica Periódica'
                : traits.pm_cadence_basis === 'CYCLES_OR_FLIGHTS'
                ? 'Plan de Mantenimiento Preventivo por Ciclos / Horas de Vuelo e Inspección Estructural'
                : traits.pm_cadence_basis === 'DUAL_KM_AND_HOURS'
                ? 'Programa de Mantenimiento Preventivo Escalado por Kilometraje (km) y Horómetro PTO/Motor (h)'
                : 'Programa de Mantenimiento Preventivo Escalado por Horómetro (10h / 250h / 500h / 1.000h / 2.000h)';

        const core: EquipmentTypeCoreChapterItem[] = [
            {
                chapter_key: 'aislamiento_loto_y_energia_cero',
                title_es: `Aislamiento de Energía Cero (LOTO), Despresurización y Puntos de Bloqueo (${label})`,
                section_es: 'SEGURIDAD DE INTERVENCIÓN Y LOTO',
                rationale_es:
                    'Procedimiento obligatorio de corte, bloqueo, etiquetado y verificación de energía cero (eléctrica, hidráulica, neumática, gravitacional o térmica) antes de intervenir.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'lubricantes_fluidos_y_capacidades_servicio',
                title_es:
                    traits.primary_energy === 'ELECTRICO_BATERIA_BEV' && traits.mobility === 'AERIAL_OR_MARINE'
                        ? 'Cuidado de Baterías Inteligentes, Almacenamiento por Nivel de Carga, Limpieza Óptica y Firmware'
                        : 'Tabla Maestra de Lubricantes, Grasas, Fluidos Dieléctricos/Hidráulicos y Capacidades Exactas',
                section_es: 'FLUIDOS, LUBRICACIÓN E INSUMOS',
                rationale_es:
                    'Especificaciones de viscosidad/norma ISO/SAE, puntos de engrase, volúmenes de llenado e intervalos de reemplazo verificados.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'plan_pm_escalonado',
                title_es: cadenceTitle,
                section_es: 'PAUTA PREVENTIVA PROGRAMADA',
                rationale_es: `Matriz de tareas preventivas, reemplazo de filtros/sellos, pares de apriete e inspecciones según la cadencia real (${traits.pm_cadence_basis}) de ${label}.`,
                priority: 'CRÍTICO',
            },
            this.buildWearAndSupportCoreChapter(traits, label),
        ];

        if (traits.requires_metrology_calibration) {
            core.push({
                chapter_key: 'calibracion_metrologica_y_trazabilidad',
                title_es: 'Protocolo de Calibración Metrológica, Tolerancias de Aceptación y Certificado Trazable',
                section_es: 'METROLOGÍA Y CONFIABILIDAD',
                rationale_es:
                    'Frecuencia obligatoria de calibración en banco patrón (ej. ISO 6789 / laboratorio acreditado INN), criterios de desviación máxima y recalibración tras sobrecarga.',
                priority: 'CRÍTICO',
            });
        }

        return { core_chapters: core, conditional_subsystems: [] };
    }

    private static buildPillar04RiskBlueprint(
        traits: AssetPhysicalTraits,
        label: string
    ): EquipmentTypePillarBlueprint {
        const specificHazardTitle =
            traits.primary_energy === 'HIDRAULICO_AUXILIAR'
                ? 'Inyección de Fluido a Ultra-Alta Presión (700 bar), Puntos de Atrapamiento en Brazo de Reacción y Proyección de Dados'
                : traits.mobility === 'AERIAL_OR_MARINE'
                ? 'Impacto por Hélices, Pérdida de Enlace RF/GNSS, Espacio Aéreo (DGAC DAN 151) e Incendio Térmico Li-Ion'
                : traits.primary_energy === 'ELECTRICO_RED_AC'
                ? 'Electrocución / Arco Eléctrico, Falla de Aislamiento/Tierra, Partida Automática Remota y Partes Rotatorias'
                : traits.functional_domain === 'LIFTING_AND_RIGGING'
                ? 'Volcamiento por Momento de Carga, Caída de Carga Suspendida, Corte de Cable y Proximidad a Líneas Eléctricas'
                : traits.functional_domain === 'COMMINUTION_AND_SCREENING'
                ? 'Atrapamiento en Cámara/Correas, Proyección de Roca, Polvo de Sílice Respirable y Ruido Industrial'
                : 'Peligros Mecánicos, Energías Peligrosas, Interacción Vial/Faena, Estabilidad e Incendio';

        const core: EquipmentTypeCoreChapterItem[] = [
            {
                chapter_key: 'peligros_criticos_especificos_activo',
                title_es: `Identificación de Peligros Críticos y Controles de Ingeniería: ${specificHazardTitle}`,
                section_es: 'MATRIZ IPERC DE RIESGOS CRÍTICOS',
                rationale_es: `Evaluación IPERC específica para la física operacional de ${label}, controles duros de ingeniería y barreras de segregación.`,
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'epp_especifico_y_limites_exposicion',
                title_es: 'Elementos de Protección Personal (EPP) Específicos, Agentes Físicos (Ruido/Vibración/Radiación) y Ergonomía',
                section_es: 'HIGIENE INDUSTRIAL Y EPP',
                rationale_es:
                    'EPP certificado exigible según la energía y proceso del equipo, control de ruido (dBA), vibraciones, humos/polvo o carga postural.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'cumplimiento_normativo_aplicable',
                title_es: `Marco Normativo Chileno e Internacional Aplicable (${this.resolveRegulatoryStandardsLabel(traits)})`,
                section_es: 'CUMPLIMIENTO NORMATIVO Y BLOQUEO',
                rationale_es:
                    'Requisitos reglamentarios vigentes en faena minera/industrial chilena y estándares ISO/IEC aplicables al equipo.',
                priority: 'CRÍTICO',
            },
        ];

        return { core_chapters: core, conditional_subsystems: [] };
    }

    private static buildPillar05PreOpChecklistBlueprint(
        traits: AssetPhysicalTraits,
        label: string
    ): EquipmentTypePillarBlueprint {
        const core: EquipmentTypeCoreChapterItem[] = [
            {
                chapter_key: 'inspeccion_fisica_previa_sin_energia',
                title_es: `Inspección Visual Estructural, Integridad de Componentes y Ausencia de Fugas/Daños (${label})`,
                section_es: 'ETAPA I — INSPECCIÓN FÍSICA PREVIA (EQUIPO DESENERGIZADO)',
                rationale_es:
                    'Chequeo físico previo a energizar: estado estructural, conexiones/mangueras/cables, elementos de desgaste/apoyo y vigencia de etiquetas/certificaciones.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'verificacion_seguridad_y_dispositivos_corte',
                title_es: 'Verificación de Protecciones, Parada de Emergencia, Bloqueos y Condiciones del Entorno',
                section_es: 'ETAPA II — DISPOSITIVOS DE SEGURIDAD Y ENTORNO',
                rationale_es:
                    'Comprobación obligatoria de guardas, paradas de emergencia, puesta a tierra/reacción/estabilización y segregación del área.',
                priority: 'CRÍTICO',
            },
            {
                chapter_key: 'prueba_funcional_y_criterios_no_go',
                title_es: 'Prueba Funcional en Vacío, Lectura de Parámetros Base y Criterios de Rechazo Inmediato (NO-GO)',
                section_es: 'ETAPA III — PRUEBA FUNCIONAL Y CRITERIOS NO-GO',
                rationale_es:
                    'Verificación dinámica de mandos/instrumentos y listado taxativo de condiciones críticas NO-GO que prohíben operar el activo.',
                priority: 'CRÍTICO',
            },
        ];

        return { core_chapters: core, conditional_subsystems: [] };
    }

    private static describeOperatorInterfaceEs(iface: OperatorInterfaceTrait): string {
        switch (iface) {
            case 'ENCLOSED_CABIN_ROPS_FOPS':
                return 'Cabina ROPS/FOPS, Mandos y Consola';
            case 'HIGHWAY_CABIN':
                return 'Cabina de Conducción, Tablero y Mandos Auxiliares/PTO';
            case 'OPEN_CANOPY_OR_SEAT':
                return 'Puesto de Operador Abierto y Controles';
            case 'WALK_BEHIND_OR_PENDANT':
                return 'Timón / Botonera Colgante de Operador a Pie';
            case 'REMOTE_RADIO_OR_GCS':
                return 'Consola de Radiocontrol / Estación Terrena (GCS) y Panel Local';
            case 'DIRECT_HAND_TRIGGER':
                return 'Empuñadura / Gatillo, Selector Mecánico y Punto de Reacción';
            case 'LOCAL_PANEL_HMI':
            default:
                return 'Tablero de Control Local HMI e Instrumentación';
        }
    }

    private static resolveRegulatoryStandardsLabel(traits: AssetPhysicalTraits): string {
        if (traits.mobility === 'AERIAL_OR_MARINE') return 'DGAC DAN 151 / DAN 91 · SUBTEL · DS 132';
        if (traits.functional_domain === 'BOLTING_TORQUE_AND_TOOLS') return 'ISO 6789 · ISO 11148 · DS 594 · DS 132';
        if (traits.primary_energy === 'ELECTRICO_RED_AC') return 'RIC SEC Pliegos Técnicos · IEC 60204 · DS 132';
        if (traits.duty_travel_regime === 'ON_HIGHWAY' || traits.duty_travel_regime === 'DUAL_ROAD_AND_SITE') {
            return 'Ley de Tránsito 18.290 · DS 132 · DS 594';
        }
        return 'DS 132 SERNAGEOMIN · DS 594 · ISO 12100';
    }
}

export function inferAssetPhysicalTraits(
    input: OntologyInferenceInput & {
        rawTypeText?: string;
        rawCategoryText?: string;
        makeModelText?: string;
    }
): AssetPhysicalTraits {
    return AssetOntologyEngine.inferAssetPhysicalTraits({
        ...input,
        canonical_type_es: input.canonical_type_es || input.rawTypeText,
        categoria_equipo: input.categoria_equipo || input.rawCategoryText,
        make_oficial: input.make_oficial || input.makeModelText,
    });
}

