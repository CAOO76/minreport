/**
 * PROYECCIÓN DETERMINISTA DE DOMINIOS OPERMAQ (`CATÁLOGO` Y `FLOTA`)
 * Y CORTAFUEGOS HOMÓLOGO POR ARQUETIPO MECÁNICO
 *
 * Cumplimiento estricto GEMINI.md (§3.1, §3.2 y Capa 4):
 * - Tolerancia cero a prosa publicitaria, eslóganes comerciales o afirmaciones operacionales falsas
 *   (ej. "carga fácil de camiones", "mayor alcance", "alta eficiencia").
 * - Comparabilidad directa 1 a 1 dentro de cada familia: todos los equipos del mismo arquetipo
 *   presentan exactamente los mismos ejes físicos obligatorios en el mismo orden y unidades SI (`tabular-nums`).
 * - Ejes sin evidencia verificada se declaran como `[No declarado en ficha]`; si ningún eje está
 *   verificado, se declara `[Información técnica no declarada en ficha]`.
 */

export const MISSING_TECH_SPEC = '[Información técnica no declarada en ficha]';
export const MISSING_AXIS_VALUE = '[No declarado en ficha]';
export const PENDING_RECORD_SPEC = '[Pendiente de registro]';

const VALID_PILLARS = [
    'ficha_tecnica',
    'manual_operaciones',
    'pauta_mantencion',
    'matriz_riesgos',
    'checklist_pre_op',
] as const;

const textCollator = new Intl.Collator('es', { sensitivity: 'base' });
const numericCollator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

export type MachineryArchetypeId =
    | 'BULLDOZER_ORUGAS'
    | 'BULLDOZER_NEUMATICOS'
    | 'MINICARGADOR_SSL_CTL'
    | 'EXCAVADORA_HIDRAULICA'
    | 'CARGADOR_FRONTAL'
    | 'RETROEXCAVADORA'
    | 'CAMION_TOLVA_CAEX'
    | 'MOTONIVELADORA'
    | 'COMPACTADOR_RODILLO'
    | 'GRUA_IZAJE_MANIPULADOR'
    | 'PERFORADORA_SONDAJE'
    | 'COMPRESOR_GENERADOR_BOMBA'
    | 'VEHICULO_LIVIANO_TRANSPORTE'
    | 'HERRAMIENTA_INDUSTRIAL_GENERAL';

export type EquipmentAxisValueKind = 'PHYSICAL_MAGNITUDE' | 'CLOSED_ENUM';

export interface CanonicalSpecSlot {
    axis_key: string;
    label_es: string;
    value_si: string | null;
    unit_si?: string;
    mandatory?: boolean;
    is_differentiator?: boolean;
    value_kind?: EquipmentAxisValueKind;
    allowed_enum_values?: string[];
    source_url?: string | null;
    verbatim_evidence?: string | null;
}

export interface ArchetypeAxisDefinition {
    axis_key: string;
    label_es: string;
    unit_hint: string;
    mandatory: boolean;
    legacyKeyPattern: RegExp;
    validValuePattern: RegExp;
}

export interface ArchetypeDefinition {
    id: MachineryArchetypeId;
    name_es: string;
    axes: ArchetypeAxisDefinition[];
}

export const FORBIDDEN_MARKETING_OR_UNVERIFIED_CLAIM_REGEX =
    /\b(carga\s+(f[aá]cil\s+)?de\s+camiones|cargu[ií]o\s+de\s+camiones|easier\s+truck\s+loading|truck\s+loading|mayor\s+alcance|alcance\s+extendido|l[ií]der\s+en|insuperable|mejor\s+de\s+su\s+clase|best[- ]in[- ]class|alta\s+eficiencia|m[aá]xima\s+eficiencia|m[aá]xima\s+productividad|[oó]ptimo\s+rendimiento|rendimiento\s+superior|excelente\s+estabilidad|gran\s+versatilidad|dise[ñn]ad[oa]\s+para\s+maximizar|proporciona\s+mayor|ofrece\s+mayor|permite\s+cargar\s+camiones|ideal\s+para|f[aá]cil\s+mantenimiento|comodidad\s+del\s+operador|confort\s+superior)\b/i;

export const ACCESSORY_HISTORICAL_SPEC_REGEX =
    /per[ií]odo\s+de\s+(producci[oó]n|fabricaci[oó]n)|a[ñn]os?\s+de\s+(producci[oó]n|fabricaci[oó]n|lanzamiento|comercializaci[oó]n)|introducid[oa]\s+en|fabricad[oa]\s+(entre|desde|en)|lanzad[oa]\s+en|primera\s+generaci[oó]n|evoluci[oó]n\s+serie|reemplaz[ao]\s+al|sucesor\s+de|antecesor\s+de|pa[ií]s\s+de\s+origen|\b(19|20)\d{2}\s*[-–—/]\s*((19|20)\d{2}|presente|actualidad|hoy)\b|\b(19|20)\d{2}\+\b/i;

const NUM_UNIT_MASS = /\b\d[\d.,]*\s*(?:kg|t\b|ton|toneladas?|lb|lbs)\b/i;
const NUM_UNIT_POWER = /\b\d[\d.,]*\s*(?:kw|hp|cv)\b/i;
const NUM_UNIT_VOLUME = /\b\d[\d.,]*\s*(?:m³|yd³|(?:m3|l|litros?|yd3)\b)(?![a-zA-Z])/i;
const NUM_UNIT_LENGTH = /\b\d[\d.,]*\s*(?:mm|m\b|cm|pulg|in)\b/i;
const NUM_UNIT_FORCE_TORQUE = /\b\d[\d.,]*\s*(?:kn|n[·.\s-]?m|kgf|daN|j\b|joules?|hz|bpm)\b/i;
const NUM_UNIT_FLOW_PRESSURE_ELEC =
    /\b\d[\d.,]*\s*(?:m³\/min|(?:l\/s|l\/min|m3\/min|cfm|scfm|bar|mpa|psi|kva|kw|v|volt|a|amp)\b)/i;
const NUM_UNIT_ENERGY_CONSUMPTION =
    /\b\d[\d.,]*\s*(?:l\/100\s*km|kwh\/100\s*km|km\/l|l\/h|gal\/h|gph|mpg|g\/kwh|lb\/hp[·.\s-]?h(?:r)?|kwh\/h|kwh\/t|l\/t|l\/ton|m³\/min|m3\/min|l\/s|l\/min|cfm|scfm|kwh|kw)\b/i;
const NUM_UNIT_ENERGY_CAPACITY =
    /\b\d[\d.,]*\s*(?:l\b|litros?|gal|kwh|ah|m³|m3)\b/i;
const ENERGY_SOURCE_VALUE_REGEX =
    /\b(di[eé]sel(?:\s+ulsd)?|gasolina|bencina|el[eé]ctric[oa](?:\s+(?:red\s+ac|trif[aá]sic[oa]|monof[aá]sic[oa]|bater[ií]a|bev))?|bater[ií]a(?:\s+bev|\s+li-?ion|\s+lfp)?|bev|h[ií]brid[oa](?:\s+di[eé]sel[- ]el[eé]ctric[oa])?|dual[- ]?fuel|glp|gnv|gnl|aire\s+comprimido|neum[aá]tic[oa]|electrohidr[aá]ulic[oa]|hidr[aá]ulic[oa])\b/i;
const ANY_SI_METRIC =
    /\b\d[\d.,]*\s*(?:l\/100\s*km|kwh\/100\s*km|km\/l|g\/kwh|lb\/hp[·.\s-]?h(?:r)?|kwh\/h|kwh\/t|l\/t|l\/ton|gal\/h|gph|mpg|m³\/min|m³|(?:kg|t|ton|kw|hp|cv|m3\/min|m3|mm|m|cm|l\/s|l\/min|l\/h|cfm|scfm|bar|mpa|psi|kn|n[·.\s-]?m|kva|kwh|ah|v|hz|j|rpm)\b)/i;

const ENERGY_AXIS_KEY_SET = new Set([
    'fuente_energia',
    'consumo_energetico_nominal',
    'capacidad_energetica_autonomia',
]);

export function resolveUniversalEnergyAxes(params?: {
    primaryEnergy?: string | null;
    energyValueText?: string | null;
    typeContextText?: string | null;
}): ArchetypeAxisDefinition[] {
    const sourceAxis: ArchetypeAxisDefinition = {
        axis_key: 'fuente_energia',
        label_es: 'Fuente energía',
        unit_hint: 'Diésel | Gasolina | Eléctrico Batería (BEV) | Eléctrico Red AC | Híbrido | GLP/GNV | Neumático',
        mandatory: false,
        legacyKeyPattern:
            /\b(fuente\s+(?:de\s+)?energ[ií]a|tipo\s+de\s+(?:combustible|energ[ií]a)|combustible|alimentaci[oó]n\s+energ[eé]tica)\b/i,
        validValuePattern: ENERGY_SOURCE_VALUE_REGEX,
    };

    const energyKind = classifyFrontendEnergyKind(params);

    switch (energyKind) {
        case 'MANUAL_MECHANICAL':
        case 'TOWED_PASSIVE':
            return [sourceAxis];
        case 'BATTERY_BEV':
            return [
                sourceAxis,
                {
                    axis_key: 'consumo_energetico_nominal',
                    label_es: 'Energía horaria',
                    unit_hint: 'kWh/h',
                    mandatory: false,
                    legacyKeyPattern:
                        /\b(energ[ií]a\s+horaria|consumo\s+(?:energ[eé]tico|nominal|el[eé]ctrico|horario)|demanda\s+energ[eé]tica|autonom[ií]a\s+por\s+carga)\b/i,
                    validValuePattern: /\b\d[\d.,]*\s*(?:kwh\/h|kwh\/100\s*km|kwh\/t|kwh|wh|kw|min|h\b|horas?)\b/i,
                },
                {
                    axis_key: 'capacidad_energetica_autonomia',
                    label_es: 'Capacidad banco baterías',
                    unit_hint: 'kWh',
                    mandatory: false,
                    legacyKeyPattern:
                        /\b(capacidad\s+(?:de\s+)?(?:banco\s+(?:de\s+)?bater[ií]as|bater[ií]a)|banco\s+(?:de\s+)?bater[ií]as|energ[ií]a\s+almacenada)\b/i,
                    validValuePattern: /\b\d[\d.,]*\s*(?:kwh|wh|ah)\b/i,
                },
            ];
        case 'GRID_AC':
            return [
                sourceAxis,
                {
                    axis_key: 'consumo_energetico_nominal',
                    label_es: 'Demanda eléctrica',
                    unit_hint: 'kWh/h',
                    mandatory: false,
                    legacyKeyPattern:
                        /\b(demanda\s+el[eé]ctrica|potencia\s+el[eé]ctrica\s+absorbida|consumo\s+(?:el[eé]ctrico|energ[eé]tico|nominal))\b/i,
                    validValuePattern: /\b\d[\d.,]*\s*(?:kwh\/h|kwh\/t|kw|kva|kwh)\b/i,
                },
                {
                    axis_key: 'capacidad_energetica_autonomia',
                    label_es: 'Alimentación eléctrica nominal',
                    unit_hint: 'V · Hz · kVA',
                    mandatory: false,
                    legacyKeyPattern:
                        /\b(alimentaci[oó]n\s+el[eé]ctrica(?:\s+nominal)?|tensi[oó]n\s+(?:nominal|de\s+alimentaci[oó]n|red)|voltaje\s+nominal|red\s+trif[aá]sica)\b/i,
                    validValuePattern: /\b\d[\d.,]*\s*(?:kv\b|v\b|volt|hz|kva|a\b|amp)\b/i,
                },
            ];
        case 'PNEUMATIC_AIR':
            return [
                sourceAxis,
                {
                    axis_key: 'consumo_energetico_nominal',
                    label_es: 'Consumo aire comprimido',
                    unit_hint: 'L/s · m³/min',
                    mandatory: false,
                    legacyKeyPattern:
                        /\b(consumo\s+(?:de\s+)?aire(?:\s+comprimido|\s+requerido)?|caudal\s+de\s+aire|demanda\s+neum[aá]tica)\b/i,
                    validValuePattern: /\b\d[\d.,]*\s*(?:l\/s|l\/min|m³\/min|m3\/min|cfm|scfm)\b/i,
                },
                {
                    axis_key: 'capacidad_energetica_autonomia',
                    label_es: 'Presión neumática',
                    unit_hint: 'bar · MPa',
                    mandatory: false,
                    legacyKeyPattern:
                        /\b(presi[oó]n\s+(?:neum[aá]tica|de\s+aire|de\s+trabajo|nominal|operativa))\b/i,
                    validValuePattern: /\b\d[\d.,]*\s*(?:bar|mpa|psi)\b/i,
                },
            ];
        case 'HYBRID':
            return [
                sourceAxis,
                {
                    axis_key: 'consumo_energetico_nominal',
                    label_es: 'Consumo horario combinado',
                    unit_hint: 'L/h · kWh/h',
                    mandatory: false,
                    legacyKeyPattern:
                        /\b(consumo\s+(?:horario\s+combinado|combinado|energ[eé]tico|nominal|de\s+combustible)|rendimiento\s+combinado)\b/i,
                    validValuePattern: NUM_UNIT_ENERGY_CONSUMPTION,
                },
                {
                    axis_key: 'capacidad_energetica_autonomia',
                    label_es: 'Capacidad estanque + batería HV',
                    unit_hint: 'L + kWh',
                    mandatory: false,
                    legacyKeyPattern:
                        /\b(capacidad\s+(?:estanque|tanque|combustible|bater[ií]a)|estanque\s*\+\s*bater[ií]a)\b/i,
                    validValuePattern: NUM_UNIT_ENERGY_CAPACITY,
                },
            ];
        case 'THERMAL_FUEL':
        default:
            return [
                sourceAxis,
                {
                    axis_key: 'consumo_energetico_nominal',
                    label_es: 'Consumo horario combustible',
                    unit_hint: 'L/h · g/kWh',
                    mandatory: false,
                    legacyKeyPattern:
                        /\b(consumo\s+(?:energ[eé]tico|nominal|de\s+combustible|espec[ií]fico|horario|el[eé]ctrico|de\s+aire)|rendimiento\s+de\s+combustible|potencia\s+el[eé]ctrica\s+absorbida|bsfc)\b/i,
                    validValuePattern: NUM_UNIT_ENERGY_CONSUMPTION,
                },
                {
                    axis_key: 'capacidad_energetica_autonomia',
                    label_es: 'Capacidad estanque combustible',
                    unit_hint: 'L',
                    mandatory: false,
                    legacyKeyPattern:
                        /\b(capacidad\s+(?:de\s+)?(?:estanque|tanque\s+de\s+combustible|banco\s+bater[ií]as|bater[ií]a)|estanque\s+(?:de\s+)?combustible|autonom[ií]a)\b/i,
                    validValuePattern: NUM_UNIT_ENERGY_CAPACITY,
                },
            ];
    }
}

export function withResolvedArchetypeEnergyAxes(
    base: ArchetypeDefinition,
    params?: {
        primaryEnergy?: string | null;
        energyValueText?: string | null;
        typeContextText?: string | null;
    }
): ArchetypeDefinition {
    const coreAxes = base.axes.filter((ax) => !ENERGY_AXIS_KEY_SET.has(ax.axis_key));
    return {
        ...base,
        axes: [...coreAxes, ...resolveUniversalEnergyAxes(params)],
    };
}

export const ARCHETYPE_DEFINITIONS: Record<MachineryArchetypeId, ArchetypeDefinition> = {
    BULLDOZER_ORUGAS: {
        id: 'BULLDOZER_ORUGAS',
        name_es: 'Bulldozer sobre Orugas',
        axes: [
            {
                axis_key: 'potencia_neta',
                label_es: 'Potencia neta',
                unit_hint: 'kW (HP)',
                mandatory: true,
                legacyKeyPattern: /\b(potencia(\s+neta|\s+al\s+volante|\s+motor)?)\b/i,
                validValuePattern: NUM_UNIT_POWER,
            },
            {
                axis_key: 'peso_operativo',
                label_es: 'Peso operativo',
                unit_hint: 'kg',
                mandatory: true,
                legacyKeyPattern: /\b(peso\s+operativo|masa\s+operativa|peso\s+de\s+operaci[oó]n|peso\b)\b/i,
                validValuePattern: NUM_UNIT_MASS,
            },
            {
                axis_key: 'capacidad_hoja',
                label_es: 'Hoja',
                unit_hint: 'm³',
                mandatory: true,
                legacyKeyPattern: /\b(capacidad\s+de\s+hoja|hoja\s+(?:su|u|s|semi[- ]?u|topadora)|volumen\s+de\s+hoja|hoja\b)\b/i,
                validValuePattern: NUM_UNIT_VOLUME,
            },
            {
                axis_key: 'tren_rodaje',
                label_es: 'Rodaje',
                unit_hint: 'Rueda cabilla elevada / Oruga convencional / LGP',
                mandatory: false,
                legacyKeyPattern: /\b(tren\s+de\s+rodaje|rueda\s+(?:motriz|cabilla)|rodaje|sprocket)\b/i,
                validValuePattern: /\b(rueda\s+(?:motriz|cabilla)\s+elevada|high\s+drive|oruga\s+convencional|baja\s+presi[oó]n|lgp)\b/i,
            },
            ...resolveUniversalEnergyAxes(),
        ],
    },
    BULLDOZER_NEUMATICOS: {
        id: 'BULLDOZER_NEUMATICOS',
        name_es: 'Bulldozer sobre Neumáticos',
        axes: [
            {
                axis_key: 'potencia_neta',
                label_es: 'Potencia neta',
                unit_hint: 'kW (HP)',
                mandatory: true,
                legacyKeyPattern: /\b(potencia(\s+neta|\s+motor)?)\b/i,
                validValuePattern: NUM_UNIT_POWER,
            },
            {
                axis_key: 'peso_operativo',
                label_es: 'Peso operativo',
                unit_hint: 'kg',
                mandatory: true,
                legacyKeyPattern: /\b(peso\s+operativo|masa\s+operativa|peso\b)\b/i,
                validValuePattern: NUM_UNIT_MASS,
            },
            {
                axis_key: 'capacidad_hoja',
                label_es: 'Hoja',
                unit_hint: 'm³',
                mandatory: true,
                legacyKeyPattern: /\b(capacidad\s+de\s+hoja|hoja)\b/i,
                validValuePattern: NUM_UNIT_VOLUME,
            },
            ...resolveUniversalEnergyAxes(),
        ],
    },
    MINICARGADOR_SSL_CTL: {
        id: 'MINICARGADOR_SSL_CTL',
        name_es: 'Minicargador / Cargador Compacto',
        axes: [
            {
                axis_key: 'capacidad_nominal_roc',
                label_es: 'ROC',
                unit_hint: 'kg',
                mandatory: true,
                legacyKeyPattern: /\b(capacidad\s+nominal(\s+de\s+operaci[oó]n)?|carga\s+nominal|\broc\b)\b/i,
                validValuePattern: NUM_UNIT_MASS,
            },
            {
                axis_key: 'altura_max_descarga',
                label_es: 'Altura máx. descarga',
                unit_hint: 'mm',
                mandatory: true,
                legacyKeyPattern: /\b(altura\s+(?:m[aá]x(?:ima)?\.?\s+(?:de\s+)?)?(?:descarga|volteo|vaciado)|dump\s+clearance)\b/i,
                validValuePattern: NUM_UNIT_LENGTH,
            },
            {
                axis_key: 'potencia_neta',
                label_es: 'Potencia neta',
                unit_hint: 'kW (HP)',
                mandatory: true,
                legacyKeyPattern: /\b(potencia(\s+neta|\s+bruta|\s+motor)?)\b/i,
                validValuePattern: NUM_UNIT_POWER,
            },
            {
                axis_key: 'peso_operativo',
                label_es: 'Peso operativo',
                unit_hint: 'kg',
                mandatory: true,
                legacyKeyPattern: /\b(peso\s+operativo|masa\s+operativa|peso\b)\b/i,
                validValuePattern: NUM_UNIT_MASS,
            },
            {
                axis_key: 'cinematica_levante',
                label_es: 'Cinemática',
                unit_hint: 'Levante vertical | Levante radial',
                mandatory: false,
                legacyKeyPattern: /\b(cinem[aá]tica|levante|levantamiento)\b/i,
                validValuePattern: /^(levante\s+vertical|levante\s+radial)$/i,
            },
            ...resolveUniversalEnergyAxes(),
        ],
    },
    EXCAVADORA_HIDRAULICA: {
        id: 'EXCAVADORA_HIDRAULICA',
        name_es: 'Excavadora / Pala Hidráulica',
        axes: [
            {
                axis_key: 'peso_operativo',
                label_es: 'Peso operativo',
                unit_hint: 'kg',
                mandatory: true,
                legacyKeyPattern: /\b(peso\s+operativo|masa\s+operativa|peso\b)\b/i,
                validValuePattern: NUM_UNIT_MASS,
            },
            {
                axis_key: 'potencia_neta',
                label_es: 'Potencia neta',
                unit_hint: 'kW (HP)',
                mandatory: true,
                legacyKeyPattern: /\b(potencia(\s+neta|\s+motor)?)\b/i,
                validValuePattern: NUM_UNIT_POWER,
            },
            {
                axis_key: 'capacidad_balde',
                label_es: 'Balde',
                unit_hint: 'm³',
                mandatory: true,
                legacyKeyPattern: /\b(capacidad\s+de\s+(?:balde|cuchar[oó]n|cuchara)|balde|cuchar[oó]n)\b/i,
                validValuePattern: NUM_UNIT_VOLUME,
            },
            {
                axis_key: 'profundidad_max_excavacion',
                label_es: 'Prof. máx. excavación',
                unit_hint: 'mm',
                mandatory: true,
                legacyKeyPattern: /\b(profundidad\s+(?:m[aá]x(?:ima)?\.?\s+(?:de\s+)?)?excavaci[oó]n|prof\.\s*m[aá]x\.\s*excavaci[oó]n|alcance\s+vertical)\b/i,
                validValuePattern: NUM_UNIT_LENGTH,
            },
            ...resolveUniversalEnergyAxes(),
        ],
    },
    CARGADOR_FRONTAL: {
        id: 'CARGADOR_FRONTAL',
        name_es: 'Cargador Frontal / LHD',
        axes: [
            {
                axis_key: 'capacidad_balde',
                label_es: 'Balde',
                unit_hint: 'm³',
                mandatory: true,
                legacyKeyPattern: /\b(capacidad\s+de\s+(?:balde|cuchar[oó]n|cuchara)|balde|cuchar[oó]n)\b/i,
                validValuePattern: NUM_UNIT_VOLUME,
            },
            {
                axis_key: 'carga_util_o_vuelco',
                label_es: 'Carga nominal',
                unit_hint: 'kg',
                mandatory: true,
                legacyKeyPattern: /\b(carga\s+(?:[uú]til|nominal|est[aá]tica\s+de\s+vuelco|operativa)|capacidad\s+de\s+carga|tramming)\b/i,
                validValuePattern: NUM_UNIT_MASS,
            },
            {
                axis_key: 'altura_max_descarga',
                label_es: 'Altura máx. descarga',
                unit_hint: 'mm',
                mandatory: true,
                legacyKeyPattern: /\b(altura\s+(?:m[aá]x(?:ima)?\.?\s+(?:de\s+)?)?(?:descarga|volteo|pasador))\b/i,
                validValuePattern: NUM_UNIT_LENGTH,
            },
            {
                axis_key: 'potencia_neta',
                label_es: 'Potencia neta',
                unit_hint: 'kW (HP)',
                mandatory: true,
                legacyKeyPattern: /\b(potencia(\s+neta|\s+motor)?)\b/i,
                validValuePattern: NUM_UNIT_POWER,
            },
            ...resolveUniversalEnergyAxes(),
        ],
    },
    RETROEXCAVADORA: {
        id: 'RETROEXCAVADORA',
        name_es: 'Retroexcavadora Cargadora',
        axes: [
            {
                axis_key: 'potencia_neta',
                label_es: 'Potencia neta',
                unit_hint: 'kW (HP)',
                mandatory: true,
                legacyKeyPattern: /\b(potencia(\s+neta|\s+motor)?)\b/i,
                validValuePattern: NUM_UNIT_POWER,
            },
            {
                axis_key: 'profundidad_max_excavacion',
                label_es: 'Prof. máx. excavación',
                unit_hint: 'mm',
                mandatory: true,
                legacyKeyPattern: /\b(profundidad\s+(?:m[aá]x(?:ima)?\.?\s+(?:de\s+)?)?excavaci[oó]n|prof\.\s*m[aá]x\.\s*excavaci[oó]n)\b/i,
                validValuePattern: NUM_UNIT_LENGTH,
            },
            {
                axis_key: 'capacidad_balde',
                label_es: 'Balde cargador',
                unit_hint: 'm³',
                mandatory: true,
                legacyKeyPattern: /\b(balde|cuchar[oó]n\s+cargador|capacidad\s+de\s+balde)\b/i,
                validValuePattern: NUM_UNIT_VOLUME,
            },
            {
                axis_key: 'peso_operativo',
                label_es: 'Peso operativo',
                unit_hint: 'kg',
                mandatory: true,
                legacyKeyPattern: /\b(peso\s+operativo|masa\s+operativa|peso\b)\b/i,
                validValuePattern: NUM_UNIT_MASS,
            },
            ...resolveUniversalEnergyAxes(),
        ],
    },
    CAMION_TOLVA_CAEX: {
        id: 'CAMION_TOLVA_CAEX',
        name_es: 'Camión Minero / Tolva / Articulado',
        axes: [
            {
                axis_key: 'carga_util_nominal',
                label_es: 'Carga útil',
                unit_hint: 't / kg',
                mandatory: true,
                legacyKeyPattern: /\b(carga\s+[uú]til(\s+nominal)?|capacidad\s+de\s+carga|payload)\b/i,
                validValuePattern: /\b\d[\d.,]*\s*(?:t\b|ton|toneladas?|kg|l\b|litros?)\b/i,
            },
            {
                axis_key: 'capacidad_tolva',
                label_es: 'Tolva colmada',
                unit_hint: 'm³ / L',
                mandatory: true,
                legacyKeyPattern: /\b(capacidad\s+(?:de\s+)?(?:tolva|caja|estanque)|volumen\s+colmado|tolva(\s+colmada)?)\b/i,
                validValuePattern: NUM_UNIT_VOLUME,
            },
            {
                axis_key: 'potencia_motor',
                label_es: 'Potencia',
                unit_hint: 'kW (HP)',
                mandatory: true,
                legacyKeyPattern: /\b(potencia(\s+bruta|\s+neta|\s+motor)?)\b/i,
                validValuePattern: NUM_UNIT_POWER,
            },
            {
                axis_key: 'peso_bruto_vehicular',
                label_es: 'PBV',
                unit_hint: 'kg / t',
                mandatory: false,
                legacyKeyPattern: /\b(peso\s+bruto(\s+vehicular|\s+operativo)?|pbv|gvw|gmw)\b/i,
                validValuePattern: NUM_UNIT_MASS,
            },
            ...resolveUniversalEnergyAxes(),
        ],
    },
    MOTONIVELADORA: {
        id: 'MOTONIVELADORA',
        name_es: 'Motoniveladora',
        axes: [
            {
                axis_key: 'potencia_neta',
                label_es: 'Potencia neta',
                unit_hint: 'kW (HP)',
                mandatory: true,
                legacyKeyPattern: /\b(potencia(\s+neta|\s+base|\s+variable)?)\b/i,
                validValuePattern: NUM_UNIT_POWER,
            },
            {
                axis_key: 'ancho_vertedera',
                label_es: 'Vertedera',
                unit_hint: 'mm',
                mandatory: true,
                legacyKeyPattern: /\b(ancho\s+de\s+(?:vertedera|hoja)|vertedera|moldboard)\b/i,
                validValuePattern: NUM_UNIT_LENGTH,
            },
            {
                axis_key: 'peso_operativo',
                label_es: 'Peso operativo',
                unit_hint: 'kg',
                mandatory: true,
                legacyKeyPattern: /\b(peso\s+operativo|masa\s+operativa|peso\b)\b/i,
                validValuePattern: NUM_UNIT_MASS,
            },
            ...resolveUniversalEnergyAxes(),
        ],
    },
    COMPACTADOR_RODILLO: {
        id: 'COMPACTADOR_RODILLO',
        name_es: 'Compactador / Rodillo',
        axes: [
            {
                axis_key: 'peso_operativo',
                label_es: 'Peso operativo',
                unit_hint: 'kg',
                mandatory: true,
                legacyKeyPattern: /\b(peso\s+operativo|masa\s+operativa|peso\b)\b/i,
                validValuePattern: NUM_UNIT_MASS,
            },
            {
                axis_key: 'fuerza_centrifuga',
                label_es: 'Fuerza centrífuga',
                unit_hint: 'kN',
                mandatory: true,
                legacyKeyPattern: /\b(fuerza\s+centr[ií]fuga|impacto)\b/i,
                validValuePattern: NUM_UNIT_FORCE_TORQUE,
            },
            {
                axis_key: 'ancho_compactacion',
                label_es: 'Ancho tambor',
                unit_hint: 'mm',
                mandatory: true,
                legacyKeyPattern: /\b(ancho\s+(?:de\s+)?(?:compactaci[oó]n|tambor|rodillo)|tambor)\b/i,
                validValuePattern: NUM_UNIT_LENGTH,
            },
            ...resolveUniversalEnergyAxes(),
        ],
    },
    GRUA_IZAJE_MANIPULADOR: {
        id: 'GRUA_IZAJE_MANIPULADOR',
        name_es: 'Equipo de Izaje / Manipulador',
        axes: [
            {
                axis_key: 'capacidad_max_izaje',
                label_es: 'Capacidad máx.',
                unit_hint: 'kg / t',
                mandatory: true,
                legacyKeyPattern: /\b(capacidad\s+(?:m[aá]x(?:ima)?\.?\s*(?:de\s+)?)?(?:carga|izaje|levante)?|carga\s+m[aá]xima)\b/i,
                validValuePattern: NUM_UNIT_MASS,
            },
            {
                axis_key: 'altura_o_alcance_max',
                label_es: 'Altura máx. levante',
                unit_hint: 'm / mm',
                mandatory: true,
                legacyKeyPattern: /\b(altura\s+m[aá]x(?:ima)?\.?(\s+levante)?|alcance\s+m[aá]x(?:imo)?|longitud\s+de\s+pluma)\b/i,
                validValuePattern: NUM_UNIT_LENGTH,
            },
            {
                axis_key: 'potencia_neta',
                label_es: 'Potencia',
                unit_hint: 'kW (HP)',
                mandatory: true,
                legacyKeyPattern: /\b(potencia(\s+neta|\s+motor)?)\b/i,
                validValuePattern: NUM_UNIT_POWER,
            },
            ...resolveUniversalEnergyAxes(),
        ],
    },
    PERFORADORA_SONDAJE: {
        id: 'PERFORADORA_SONDAJE',
        name_es: 'Perforadora / Equipo de Sondaje',
        axes: [
            {
                axis_key: 'diametro_perforacion',
                label_es: 'Diámetro perf.',
                unit_hint: 'mm',
                mandatory: true,
                legacyKeyPattern: /\b(di[aá]metro\s+(?:de\s+)?(?:perforaci[oó]n|perf\.|broca|barreno)|rango\s+de\s+perforaci[oó]n)\b/i,
                validValuePattern: /\b(\d[\d.,]*\s*(?:mm|pulg|in)|[bhnp]q)\b/i,
            },
            {
                axis_key: 'energia_o_frecuencia_impacto',
                label_es: 'Impacto / Frecuencia',
                unit_hint: 'J / Hz / kW',
                mandatory: true,
                legacyKeyPattern: /\b(energ[ií]a\s+de\s+impacto|frecuencia\s+de\s+impacto|impacto\s*\/\s*frecuencia|potencia\s+de\s+percusi[oó]n|fuerza\s+de\s+avance|pullback)\b/i,
                validValuePattern: /\b\d[\d.,]*\s*(?:j\b|hz|bpm|kw|kn|n[·\s-]?m)\b/i,
            },
            {
                axis_key: 'consumo_o_potencia',
                label_es: 'Consumo / Potencia',
                unit_hint: 'L/s / kW',
                mandatory: true,
                legacyKeyPattern: /\b(consumo(\s+de\s+aire|\s*\/\s*potencia)?|potencia(\s+instalada|\s+motor)?|presi[oó]n\s+de\s+trabajo)\b/i,
                validValuePattern: NUM_UNIT_FLOW_PRESSURE_ELEC,
            },
            {
                axis_key: 'peso_operativo',
                label_es: 'Peso',
                unit_hint: 'kg',
                mandatory: true,
                legacyKeyPattern: /\b(peso(\s+operativo|\s+neto)?|masa)\b/i,
                validValuePattern: NUM_UNIT_MASS,
            },
            ...resolveUniversalEnergyAxes(),
        ],
    },
    COMPRESOR_GENERADOR_BOMBA: {
        id: 'COMPRESOR_GENERADOR_BOMBA',
        name_es: 'Planta de Energía / Compresión / Bombeo',
        axes: [
            {
                axis_key: 'salida_nominal',
                label_es: 'Salida nominal',
                unit_hint: 'm³/min / kVA / L/s',
                mandatory: true,
                legacyKeyPattern: /\b(salida\s+nominal|caudal(\s+de\s+aire\s+libre)?|potencia\s+(?:prime|continua|nominal|standby)|capacidad\s+nominal)\b/i,
                validValuePattern: NUM_UNIT_FLOW_PRESSURE_ELEC,
            },
            {
                axis_key: 'presion_o_tension_nominal',
                label_es: 'Presión / Tensión',
                unit_hint: 'bar / V',
                mandatory: true,
                legacyKeyPattern: /\b(presi[oó]n(\s+nominal|\s+de\s+trabajo|\s*\/\s*tensi[oó]n)?|tensi[oó]n|voltaje|altura\s+manom[eé]trica)\b/i,
                validValuePattern: /\b\d[\d.,]*\s*(?:bar|mpa|psi|v\b|volt|m\.?c\.?a\.?|m\b)\b/i,
            },
            {
                axis_key: 'potencia_motriz',
                label_es: 'Potencia motriz',
                unit_hint: 'kW (HP)',
                mandatory: true,
                legacyKeyPattern: /\b(potencia\s+(?:motor|motriz|eje)|motor)\b/i,
                validValuePattern: NUM_UNIT_POWER,
            },
            ...resolveUniversalEnergyAxes(),
        ],
    },
    VEHICULO_LIVIANO_TRANSPORTE: {
        id: 'VEHICULO_LIVIANO_TRANSPORTE',
        name_es: 'Vehículo de Transporte / Apoyo',
        axes: [
            {
                axis_key: 'potencia_neta',
                label_es: 'Potencia',
                unit_hint: 'kW (HP)',
                mandatory: true,
                legacyKeyPattern: /\b(potencia(\s+neta|\s+m[aá]xima|\s+motor)?)\b/i,
                validValuePattern: NUM_UNIT_POWER,
            },
            {
                axis_key: 'par_motor',
                label_es: 'Torque',
                unit_hint: 'N·m',
                mandatory: true,
                legacyKeyPattern: /\b(torque|par\s+motor)\b/i,
                validValuePattern: NUM_UNIT_FORCE_TORQUE,
            },
            {
                axis_key: 'capacidad_carga_o_arrastre',
                label_es: 'Carga útil',
                unit_hint: 'kg',
                mandatory: true,
                legacyKeyPattern: /\b(carga\s+[uú]til|capacidad\s+de\s+(?:carga|arrastre|remolque))\b/i,
                validValuePattern: NUM_UNIT_MASS,
            },
            {
                axis_key: 'traccion',
                label_es: 'Tracción',
                unit_hint: '4x4 | 4x2 | AWD | 6x4',
                mandatory: false,
                legacyKeyPattern: /\b(tracci[oó]n|transmisi[oó]n\s+motriz)\b/i,
                validValuePattern: /\b([2468]x[2468]|awd|4wd|2wd|fwd|rwd|integral)\b/i,
            },
            ...resolveUniversalEnergyAxes(),
        ],
    },
    HERRAMIENTA_INDUSTRIAL_GENERAL: {
        id: 'HERRAMIENTA_INDUSTRIAL_GENERAL',
        name_es: 'Equipamiento / Herramienta Industrial',
        axes: [
            {
                axis_key: 'capacidad_trabajo',
                label_es: 'Capacidad nominal',
                unit_hint: 'mm / kg / N·m / m³',
                mandatory: true,
                legacyKeyPattern: /\b(capacidad|di[aá]metro|alcance|torque|rango|carga|volumen|balde|hoja)\b/i,
                validValuePattern: ANY_SI_METRIC,
            },
            {
                axis_key: 'potencia_energia',
                label_es: 'Potencia / Consumo',
                unit_hint: 'kW / HP / bar / L/min',
                mandatory: true,
                legacyKeyPattern: /\b(potencia|consumo|caudal|presi[oó]n|velocidad|impacto|tensi[oó]n)\b/i,
                validValuePattern: ANY_SI_METRIC,
            },
            {
                axis_key: 'masa_operativa',
                label_es: 'Peso operativo',
                unit_hint: 'kg',
                mandatory: true,
                legacyKeyPattern: /\b(peso(\s+operativo|\s+neto)?|masa)\b/i,
                validValuePattern: NUM_UNIT_MASS,
            },
            ...resolveUniversalEnergyAxes(),
        ],
    },
};

export interface SortableEquipmentRecord {
    id: string;
    make_oficial?: string;
    make?: string;
    model_oficial?: string;
    model?: string;
    tipo_equipo?: string;
    categoria_equipo?: string;
    serial_number?: string;
    identifier_value?: string;
}

export interface EquipmentBrandTypeGroup<T extends SortableEquipmentRecord> {
    groupKey: string;
    brandLabel: string;
    machineryTypeLabel: string;
    items: T[];
}

export function normalizeCompactSerialIdentifier(raw: string): string {
    return String(raw || '')
        .trim()
        .toUpperCase()
        .replace(/[\s\-_./]+/g, '');
}

/**
 * Limpia la denominación del tipo de maquinaria para encabezados de lista:
 * elimina glosas en paréntesis (traducciones inglesas, series comerciales, años) y espacios sobrantes.
 */
export function cleanMachineryTypeLabel(rawType?: string): string {
    const base = String(rawType || '').trim();
    if (!base || base.startsWith('[')) return MISSING_TECH_SPEC;

    const withoutParens = base
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\b(19|20)\d{2}\s*[-–—/]\s*((19|20)\d{2}|presente|actualidad)\b/gi, ' ')
        .replace(/\b(19|20)\d{2}\+\b/g, ' ')
        .replace(/\s*[-–—]\s*serie\s+[a-z0-9-]+$/i, '')
        .replace(/\s+/g, ' ')
        .trim();

    return withoutParens || base;
}

export function resolveMachineryArchetype(
    tipoEquipo?: string | null,
    categoriaEquipo?: string | null,
    energyContext?: {
        primaryEnergy?: string | null;
        energyValueText?: string | null;
    }
): ArchetypeDefinition {
    const typeContextText = `${tipoEquipo || ''} ${categoriaEquipo || ''}`;
    const combined = typeContextText
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    let matched: ArchetypeDefinition = ARCHETYPE_DEFINITIONS.HERRAMIENTA_INDUSTRIAL_GENERAL;

    if (/\b(minicargador|skid\s*steer|cargador\s+compacto|compact\s+track\s+loader|\bssl\b|\bctl\b)\b/.test(combined)) {
        matched = ARCHETYPE_DEFINITIONS.MINICARGADOR_SSL_CTL;
    } else if (/\b(bulldozer|tractor\s+topador|tractor\s+sobre\s+orugas|tractor\s+de\s+cadenas|dozer)\b/.test(combined)) {
        matched = /\b(neumatic|ruedas|wheel\s+dozer)\b/.test(combined)
            ? ARCHETYPE_DEFINITIONS.BULLDOZER_NEUMATICOS
            : ARCHETYPE_DEFINITIONS.BULLDOZER_ORUGAS;
    } else if (/\b(retroexcavadora|backhoe)\b/.test(combined)) {
        matched = ARCHETYPE_DEFINITIONS.RETROEXCAVADORA;
    } else if (/\b(excavadora|pala\s+hidraulica|pala\s+electrica|pala\s+de\s+cables)\b/.test(combined)) {
        matched = ARCHETYPE_DEFINITIONS.EXCAVADORA_HIDRAULICA;
    } else if (/\b(cargador\s+frontal|cargador\s+sobre\s+ruedas|cargador\s+de\s+ruedas|scooptram|\blhd\b|wheel\s+loader)\b/.test(combined)) {
        matched = ARCHETYPE_DEFINITIONS.CARGADOR_FRONTAL;
    } else if (/\b(camion\s+(?:minero|caex|extraccion|tolva|volquete|articulado|aljibe|batea)|caex|dumper|volquete)\b/.test(combined)) {
        matched = ARCHETYPE_DEFINITIONS.CAMION_TOLVA_CAEX;
    } else if (/\b(motoniveladora|motor\s*grader)\b/.test(combined)) {
        matched = ARCHETYPE_DEFINITIONS.MOTONIVELADORA;
    } else if (/\b(compactador|rodillo\s+vibratorio|rodillo\s+compactador|placa\s+compactadora)\b/.test(combined)) {
        matched = ARCHETYPE_DEFINITIONS.COMPACTADOR_RODILLO;
    } else if (/\b(grua|camion\s+pluma|manipulador\s+telescopico|telehandler|horquilla|montacargas|alza\s*hombre|manlift)\b/.test(combined)) {
        matched = ARCHETYPE_DEFINITIONS.GRUA_IZAJE_MANIPULADOR;
    } else if (/\b(perforadora|jackleg|stopper|jumbo|sondaje|martillo\s+neumatico|drill|simba|roc\b)\b/.test(combined)) {
        matched = ARCHETYPE_DEFINITIONS.PERFORADORA_SONDAJE;
    } else if (/\b(compresor|generador|grupo\s+electrogeno|motobomba|bomba\s+centrifuga|soldadora|torre\s+de\s+iluminacion)\b/.test(combined)) {
        matched = ARCHETYPE_DEFINITIONS.COMPRESOR_GENERADOR_BOMBA;
    } else if (
        /\b(camioneta|pick[- ]?up|tractocamion|furgon|furgoneta|van|minivan|bus|minibus|autobus|suv|crossover|automovil|sedan|hatchback|citycar|station\s+wagon|todo\s*terreno|4x4|ambulancia|motocicleta|moto\b|cuatrimoto|atv|utv|vehiculo|camion\s+(?:3\/4|plano|cerrado|reparto|forestal|combustible|lubricador))\b/.test(
            combined
        )
    ) {
        matched = ARCHETYPE_DEFINITIONS.VEHICULO_LIVIANO_TRANSPORTE;
    }

    return withResolvedArchetypeEnergyAxes(matched, {
        primaryEnergy: energyContext?.primaryEnergy || null,
        energyValueText: energyContext?.energyValueText || null,
        typeContextText,
    });
}

function stripTextAccents(val: string): string {
    return String(val || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

export function normalizeCanonicalEnergyEnumLabel(rawVal: string): string | null {
    const norm = stripTextAccents(rawVal);
    if (!norm) return null;
    if (/\bdual[- ]?fuel\b/.test(norm)) return 'Dual-Fuel Diésel-Gas';
    if (/\bhibrid/.test(norm)) {
        return /\b(gasolina|bencina)\b/.test(norm)
            ? 'Híbrido Gasolina-Eléctrico'
            : 'Híbrido Diésel-Eléctrico';
    }
    if (/\b(glp|gnv|gnl|gas\s+licuado|gas\s+natural)\b/.test(norm)) return 'GLP / GNV';
    if (/\b(neumatic|aire\s+comprimido)\b/.test(norm)) return 'Neumático (Aire Comprimido)';
    if (/\belectrohidraulic/.test(norm)) return 'Electrohidráulico';
    if (/\b(bateria|bev|li-?ion|lfp)\b/.test(norm) && !/\b(diesel|gasolina)\b/.test(norm)) {
        return 'Eléctrico Batería (BEV)';
    }
    if (/\belectric/.test(norm) && !/\b(diesel|gasolina)\b/.test(norm)) {
        return 'Eléctrico Red AC';
    }
    if (/\b(gasolina|bencina|nafta)\b/.test(norm)) return 'Gasolina';
    if (/\b(diesel|turbodiesel|ulsd)\b/.test(norm)) return 'Diésel';
    return null;
}

export function cleanCanonicalAxisValue(
    rawVal: unknown,
    axisDef?: ArchetypeAxisDefinition
): string | null {
    const str = String(rawVal ?? '')
        .replace(/\(EU\s+Stage[^)]*\)/gi, '')
        .replace(/\(Tier\s+\d[^)]*\)/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!str || str.startsWith('[') || /^(null|undefined|n\/a|n\/d|pendiente|no\s+declarado.*|-)$/i.test(str)) {
        return null;
    }
    if (FORBIDDEN_MARKETING_OR_UNVERIFIED_CLAIM_REGEX.test(str)) {
        return null;
    }
    if (ACCESSORY_HISTORICAL_SPEC_REGEX.test(str)) {
        return null;
    }

    let valueOnly = str;
    const colonIdx = str.indexOf(':');
    if (colonIdx > 0 && colonIdx < 48) {
        valueOnly = str.slice(colonIdx + 1).trim();
    }

    valueOnly = valueOnly.replace(/\.+$/, '').trim();
    if (!valueOnly || valueOnly.length > 68) {
        return null;
    }

    if (axisDef?.axis_key === 'fuente_energia' || axisDef?.validValuePattern === ENERGY_SOURCE_VALUE_REGEX) {
        const canonEnergy = normalizeCanonicalEnergyEnumLabel(valueOnly);
        if (canonEnergy) return canonEnergy;
    }

    if (axisDef && !axisDef.validValuePattern.test(valueOnly)) {
        return null;
    }

    return valueOnly;
}

/**
 * Sanea una línea operacional individual bloqueando eslóganes de marketing y datos históricos accesorios.
 */
export function sanitizeOperationalSpecLine(rawLine: string): string | null {
    const trimmed = String(rawLine || '').trim();
    if (!trimmed || trimmed.startsWith('[')) return null;
    if (FORBIDDEN_MARKETING_OR_UNVERIFIED_CLAIM_REGEX.test(trimmed)) return null;
    if (ACCESSORY_HISTORICAL_SPEC_REGEX.test(trimmed)) return null;

    const segments = trimmed
        .split(/\s*[—–]\s*/)
        .map((seg) =>
            seg
                .replace(/\(EU\s+Stage[^)]*\)/gi, '')
                .replace(/\(Tier\s+\d[^)]*\)/gi, '')
                .replace(/\(ROC\)/gi, '')
                .replace(/\s+([,.;:])/g, '$1')
                .replace(/\s+/g, ' ')
                .trim()
        )
        .filter(
            (seg) =>
                seg.length > 0 &&
                !FORBIDDEN_MARKETING_OR_UNVERIFIED_CLAIM_REGEX.test(seg) &&
                !ACCESSORY_HISTORICAL_SPEC_REGEX.test(seg)
        );

    if (segments.length === 0) return null;

    if (
        segments.length >= 2 &&
        /^motor\b/i.test(segments[0]) &&
        !/\d+\s*(kw|hp|cv|l\/min|bar|mpa|kg|t\b|nm)/i.test(segments[0])
    ) {
        return segments.slice(1).join(' · ');
    }

    return segments.join(' · ');
}

function inferDiscreteSkidSteerKinematics(record: Record<string, any>): string | null {
    const cleanSources = [
        String(record.tipo_equipo || ''),
        ...(Array.isArray(record.caracteristicas_principales) ? record.caracteristicas_principales.map(String) : []),
    ].filter((line) => line && !FORBIDDEN_MARKETING_OR_UNVERIFIED_CLAIM_REGEX.test(line));
    const sources = cleanSources.join(' ');

    if (/\b(levante|levantamiento|cinem[aá]tica\s+de\s+levante)\s+vertical\b|\bvertical\s+lift\b/i.test(sources)) {
        return 'Levante vertical';
    }
    if (/\b(levante|levantamiento|cinem[aá]tica\s+de\s+levante)\s+radial\b|\bradial\s+lift\b/i.test(sources)) {
        return 'Levante radial';
    }
    return null;
}

export const ANY_ENGINEERING_METRIC_REGEX =
    /\b(\d[\d.,]*\s*(?:l\/100\s*km|kwh\/100\s*km|km\/l|g\/kwh|lb\/hp[·.\s-]?h(?:r)?|kwh\/h|kwh\/t|l\/t|l\/ton|gal\/h|gph|mpg|m³\/min|m³\/h|m3\/min|m3\/h|l\/min|l\/s|l\/h|km\/h|m\/s|kn[·.\s-]?m|t[·.\s-]?m|n[·.\s-]?m|m\.?c\.?a\.?|m³|m²|cm³|yd³|°c|dba|db|kwh|kva|kw|mw|hp|cv|kgf|kg|toneladas?|ton|lbs?|mm|cm|km|pulg|ft|in|m3|m2|cm3|cc|yd3|litros?|gal|scfm|cfm|gpm|mbar|bar|mpa|kpa|psi|kn|kj|hz|khz|mhz|bpm|rpm|mah|ah|wh|kv|mv|volt|amp|[tgwvnajmlh%])\b|[2468]x[2468]|\b(?:awd|4wd|2wd|fwd|rwd|[bhnp]q)\b|\d[\d.,]*\s*°)/i;

export function normalizeCanonicalTransmissionEnumLabel(rawVal: string): string | null {
    const clean = String(rawVal || '').trim().replace(/\s+/g, ' ');
    const norm = stripTextAccents(clean);
    if (!norm) return null;

    const specificModelMatch = clean.match(
        /\b(allison\s*[0-9a-z-]*|mdrive(?:\s*hd)?|i-?shift|opticruise|traxon|powershift|eaton\s*fuller(?:\s*[0-9a-z-]+)?|fuller(?:\s*[0-9a-z-]+)?|roadranger|zf\s*[0-9a-z-]+|cvt|ivt|ecvt)\b/i
    );
    const suffix = specificModelMatch ? ` (${specificModelMatch[1].trim()})` : '';

    if (/\b(mdrive|i-?shift|opticruise|traxon|amt\b|automatizad[oa])\b/.test(norm)) {
        return `Automatizada AMT${suffix}`;
    }
    if (/\b(allison|convertidor\s+de\s+par|automatic[oa])\b/.test(norm) && !/\bhidrostatic/.test(norm)) {
        return `Automática${suffix}`;
    }
    if (/\b(fuller|roadranger|eaton)\b/.test(norm)) {
        return `Manual Eaton Fuller${suffix.toLowerCase().includes('fuller') ? '' : suffix}`;
    }
    if (/\bpowershift\b/.test(norm)) {
        return 'Powershift';
    }
    if (/\bhidrostatic/.test(norm)) {
        return 'Hidrostática';
    }
    if (/\b(cvt|ivt|ecvt|continuamente\s+variable)\b/.test(norm)) {
        return `CVT / IVT${suffix}`;
    }
    if (/\b(electric[oa]|ac\s+drive|dc\s+drive)\b/.test(norm)) {
        return 'Eléctrica AC/DC';
    }
    if (/\b(manual|mecanica|sincronizad[oa])\b/.test(norm)) {
        return `Manual${suffix}`;
    }
    if (/\b(direct[oa]|reductor)\b/.test(norm)) {
        return 'Directa / Reductor';
    }
    return null;
}

export function cleanDynamicAxisValue(
    rawVal: unknown,
    axisMeta?: {
        axis_key?: string;
        value_kind?: EquipmentAxisValueKind;
        allowed_enum_values?: string[];
        unit_si?: string;
    }
): string | null {
    const str = String(rawVal ?? '')
        .replace(/\(EU\s+Stage[^)]*\)/gi, '')
        .replace(/\(Tier\s+\d[^)]*\)/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!str || str.startsWith('[') || /^(null|undefined|n\/a|n\/d|pendiente|no\s+declarado.*|-)$/i.test(str)) {
        return null;
    }
    if (FORBIDDEN_MARKETING_OR_UNVERIFIED_CLAIM_REGEX.test(str)) {
        return null;
    }
    if (ACCESSORY_HISTORICAL_SPEC_REGEX.test(str)) {
        return null;
    }

    let valueOnly = str;
    const colonIdx = str.indexOf(':');
    if (colonIdx > 0 && colonIdx < 48) {
        valueOnly = str.slice(colonIdx + 1).trim();
    }
    valueOnly = valueOnly.replace(/\.+$/, '').trim();
    if (!valueOnly || valueOnly.length > 72) {
        return null;
    }

    const axisKeyNorm = String(axisMeta?.axis_key || '').toLowerCase();
    if (axisKeyNorm === 'fuente_energia' || /^(fuente_energia|tipo_combustible|tipo_energia)$/i.test(axisKeyNorm)) {
        const canonEnergy = normalizeCanonicalEnergyEnumLabel(valueOnly);
        if (canonEnergy) return canonEnergy;
    }
    if (/^(transmision_caja|tipo_transmision|caja_cambios|transmision)$/i.test(axisKeyNorm)) {
        const canonTx = normalizeCanonicalTransmissionEnumLabel(valueOnly);
        if (canonTx) return canonTx;
    }
    if (/^(traccion_ejes|configuracion_ejes|formula_rodado|traccion)$/i.test(axisKeyNorm)) {
        const axleMatch = valueOnly.match(/\b(4x2|4x4|6x2|6x4|6x6|8x4|8x6|8x8|10x4|10x6|awd|4wd|2wd)\b/i);
        if (axleMatch) {
            const tok = axleMatch[1];
            return /^\d/.test(tok) ? tok.toLowerCase() : tok.toUpperCase();
        }
    }

    if (axisMeta?.value_kind === 'CLOSED_ENUM' && Array.isArray(axisMeta.allowed_enum_values) && axisMeta.allowed_enum_values.length > 0) {
        const canonEnergy = normalizeCanonicalEnergyEnumLabel(valueOnly);
        if (canonEnergy && axisMeta.allowed_enum_values.includes(canonEnergy)) {
            return canonEnergy;
        }
        const canonTx = normalizeCanonicalTransmissionEnumLabel(valueOnly);
        if (canonTx) return canonTx;

        const normCandidate = valueOnly
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
        const exact = axisMeta.allowed_enum_values.find((allowed) => {
            const normAllowed = allowed
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase();
            return normCandidate === normAllowed || normCandidate.includes(normAllowed);
        });
        return exact || null;
    }

    if (ANY_ENGINEERING_METRIC_REGEX.test(valueOnly)) {
        return valueOnly;
    }

    if (/^(?:(?:4|6|8|10)x(?:2|4|6|8)|awd|4wd|2wd|fwd|rwd|levante\s+(?:vertical|radial)|orugas?.*|lgp)$/i.test(valueOnly)) {
        return valueOnly;
    }

    return null;
}

export function hasSelfDescribingTypeSchema<
    T extends {
        equipment_type_key?: string;
        canonical_specs?: CanonicalSpecSlot[] | Record<string, any> | null;
    },
>(record: T): record is T & { canonical_specs: CanonicalSpecSlot[] } {
    if (!Array.isArray(record.canonical_specs) || record.canonical_specs.length < 2) {
        return false;
    }
    if (record.equipment_type_key && String(record.equipment_type_key).trim().length >= 2) {
        return true;
    }
    return record.canonical_specs.some(
        (s) =>
            s &&
            typeof s === 'object' &&
            (typeof s.mandatory === 'boolean' ||
                s.value_kind === 'PHYSICAL_MAGNITUDE' ||
                s.value_kind === 'CLOSED_ENUM')
    );
}

export type FrontendResolvedEnergyKind =
    | 'THERMAL_FUEL'
    | 'BATTERY_BEV'
    | 'HYBRID'
    | 'GRID_AC'
    | 'PNEUMATIC_AIR'
    | 'HYDRAULIC_AUX'
    | 'TOWED_PASSIVE'
    | 'MANUAL_MECHANICAL';

function stripFrontendAccents(raw: string): string {
    return String(raw || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

export function classifyFrontendEnergyKind(params?: {
    primaryEnergy?: string | null;
    energyValueText?: string | null;
    typeContextText?: string | null;
}): FrontendResolvedEnergyKind {
    const valNorm = stripFrontendAccents(params?.energyValueText || '');
    const primaryNorm = String(params?.primaryEnergy || '').trim().toUpperCase();
    const ctxNorm = stripFrontendAccents(params?.typeContextText || '');

    if (valNorm && !valNorm.startsWith('[')) {
        if (/\b(manual|mecanico|sin\s+energia\s+externa)\b/.test(valNorm)) return 'MANUAL_MECHANICAL';
        if (/\b(remolcado|sin\s+propulsion\s+propia)\b/.test(valNorm) && !/\b(diesel|gasolina)\b/.test(valNorm)) {
            return 'TOWED_PASSIVE';
        }
        if (/\b(hidraulico\s+auxiliar|electrohidraulico|700\s*bar)\b/.test(valNorm) && !/\b(diesel|gasolina)\b/.test(valNorm)) {
            return 'HYDRAULIC_AUX';
        }
        if (/\b(neumatico|aire\s+comprimido)\b/.test(valNorm) && !/\b(diesel|gasolina)\b/.test(valNorm)) {
            return 'PNEUMATIC_AIR';
        }
        if (/\bhibrid/.test(valNorm)) return 'HYBRID';
        if (/\b(bateria|bev|li-?ion|lfp)\b/.test(valNorm) && !/\b(diesel|gasolina|remolcado|auxiliar\s+12v)\b/.test(valNorm)) {
            return 'BATTERY_BEV';
        }
        if (/\b(electrico\s+red|red\s+ac|trifasic|monofasic|corriente\s+alterna)\b/.test(valNorm) && !/\b(diesel|gasolina)\b/.test(valNorm)) {
            return 'GRID_AC';
        }
        if (/\b(diesel|gasolina|bencina|glp|gnv|gnl|dual[- ]?fuel|combustible)\b/.test(valNorm)) {
            return 'THERMAL_FUEL';
        }
    }

    if (primaryNorm) {
        if (primaryNorm === 'MANUAL_MECANICO') return 'MANUAL_MECHANICAL';
        if (primaryNorm === 'REMOLCADO_SIN_PROPULSION_PROPIA') return 'TOWED_PASSIVE';
        if (primaryNorm === 'HIDRAULICO_AUXILIAR') return 'HYDRAULIC_AUX';
        if (primaryNorm === 'NEUMATICO_AIRE_COMPRIMIDO') return 'PNEUMATIC_AIR';
        if (primaryNorm === 'ELECTRICO_RED_AC') return 'GRID_AC';
        if (primaryNorm === 'ELECTRICO_BATERIA_BEV') return 'BATTERY_BEV';
        if (primaryNorm === 'HIBRIDO_DIESEL_ELECTRICO' || primaryNorm === 'HIBRIDO_GASOLINA_ELECTRICO') {
            return 'HYBRID';
        }
        if (
            primaryNorm === 'DIESEL' ||
            primaryNorm === 'GASOLINA' ||
            primaryNorm === 'GLP_GNV' ||
            primaryNorm === 'DUAL_FUEL_DIESEL_GAS'
        ) {
            return 'THERMAL_FUEL';
        }
    }

    if (/\b(torquimetro\s+manual|tecle\s+manual|polipasto\s+manual|gata\s+mecanica|herramienta\s+manual)\b/.test(ctxNorm)) {
        return 'MANUAL_MECHANICAL';
    }
    if (
        /\b(carro\s+de\s+arrastre|remolque|semirremolque|cama\s+baja|lowboy|acoplado|estanque\s+(?:movil\s+)?remolcado|cisterna\s+remolcada|implemento\s+remolcado|dolly|sin\s+propulsion\s+propia)\b/.test(
            ctxNorm
        ) &&
        !/\b(autopropulsad|motor\s+diesel|tractocamion)\b/.test(ctxNorm)
    ) {
        return 'TOWED_PASSIVE';
    }
    if (/\b(llave\s+(?:de\s+)?torque\s+hidraulic|700\s*bar|cilindro\s+hidraulico\s+portatil|tensor\s+hidraulico)\b/.test(ctxNorm)) {
        return 'HYDRAULIC_AUX';
    }
    if (/\b(perforadora\s+neumatica|jackleg|stoper|martillo\s+neumatico|herramienta\s+neumatica)\b/.test(ctxNorm)) {
        return 'PNEUMATIC_AIR';
    }
    if (/\b(dron|rpas|uav|bev|a\s+bateria|inalambric)\b/.test(ctxNorm) && !/\b(diesel|gasolina)\b/.test(ctxNorm)) {
        return 'BATTERY_BEV';
    }
    if (
        /\b(pala\s+electrica\s+de\s+cables|bomba\s+sumergible|chancador\s+fijo|molino\s+sag|molino\s+de\s+bolas|harnero\s+estacionario|soldadora\s+inverter|compresor\s+estacionario\s+electrico|motor\s+electrico\s+trifasico)\b/.test(
            ctxNorm
        ) &&
        !/\b(diesel|motobomba\s+diesel)\b/.test(ctxNorm)
    ) {
        return 'GRID_AC';
    }

    return 'THERMAL_FUEL';
}

export function resolveFrontendEnergySemantics(params?: {
    primaryEnergy?: string | null;
    energyValueText?: string | null;
    typeContextText?: string | null;
}): {
    energyKind: FrontendResolvedEnergyKind;
    includeConsumptionAxis: boolean;
    includeCapacityAxis: boolean;
    consumptionLabelEs: string;
    consumptionUnitSi: string;
    capacityLabelEs: string | null;
    capacityUnitSi: string | null;
} {
    const energyKind = classifyFrontendEnergyKind(params);
    const ctxNorm = stripFrontendAccents(params?.typeContextText || '');
    const isRoadOrUtilityVehicle =
        /\b(camion\s+tolva|tractocamion|camion\s+aljibe|camion\s+pluma|camion\s+lubricador|camion\s+mixer|camioneta|pick\s*up|automovil|suv|furgon|van|bus|minibus|vehiculo|motocicleta|volquete)\b/.test(
            ctxNorm
        ) && !/\b(caex|camion\s+de\s+extraccion|ultra\s*class)\b/.test(ctxNorm);
    const isDroneOrCyclicBattery = /\b(dron|rpas|uav|herramienta\s+inalambrica)\b/.test(ctxNorm);

    switch (energyKind) {
        case 'MANUAL_MECHANICAL':
        case 'TOWED_PASSIVE':
            return {
                energyKind,
                includeConsumptionAxis: false,
                includeCapacityAxis: false,
                consumptionLabelEs: 'Consumo energético',
                consumptionUnitSi: '0 W',
                capacityLabelEs: null,
                capacityUnitSi: null,
            };
        case 'GRID_AC':
            return {
                energyKind,
                includeConsumptionAxis: true,
                includeCapacityAxis: true,
                consumptionLabelEs: 'Demanda eléctrica',
                consumptionUnitSi: 'kWh/h',
                capacityLabelEs: 'Alimentación eléctrica nominal',
                capacityUnitSi: 'V · Hz · kVA',
            };
        case 'PNEUMATIC_AIR':
            return {
                energyKind,
                includeConsumptionAxis: true,
                includeCapacityAxis: true,
                consumptionLabelEs: 'Consumo aire comprimido',
                consumptionUnitSi: 'L/s · m³/min',
                capacityLabelEs: 'Presión neumática',
                capacityUnitSi: 'bar · MPa',
            };
        case 'HYDRAULIC_AUX':
            return {
                energyKind,
                includeConsumptionAxis: true,
                includeCapacityAxis: false,
                consumptionLabelEs: 'Caudal / presión hidráulica req.',
                consumptionUnitSi: 'L/min @ bar',
                capacityLabelEs: null,
                capacityUnitSi: null,
            };
        case 'BATTERY_BEV':
            return {
                energyKind,
                includeConsumptionAxis: true,
                includeCapacityAxis: true,
                consumptionLabelEs: isRoadOrUtilityVehicle
                    ? 'Consumo eléctrico nominal'
                    : isDroneOrCyclicBattery
                    ? 'Autonomía por carga'
                    : 'Energía horaria',
                consumptionUnitSi: isRoadOrUtilityVehicle ? 'kWh/100 km' : isDroneOrCyclicBattery ? 'min · Wh' : 'kWh/h',
                capacityLabelEs: 'Capacidad banco baterías',
                capacityUnitSi: 'kWh',
            };
        case 'HYBRID':
            return {
                energyKind,
                includeConsumptionAxis: true,
                includeCapacityAxis: true,
                consumptionLabelEs: isRoadOrUtilityVehicle ? 'Rendimiento combinado' : 'Consumo horario combinado',
                consumptionUnitSi: isRoadOrUtilityVehicle ? 'km/L · kWh/100 km' : 'L/h · kWh/h',
                capacityLabelEs: 'Capacidad estanque + batería HV',
                capacityUnitSi: 'L + kWh',
            };
        case 'THERMAL_FUEL':
        default:
            return {
                energyKind: 'THERMAL_FUEL',
                includeConsumptionAxis: true,
                includeCapacityAxis: true,
                consumptionLabelEs: isRoadOrUtilityVehicle
                    ? 'Rendimiento / consumo combustible'
                    : 'Consumo horario combustible',
                consumptionUnitSi: isRoadOrUtilityVehicle ? 'km/L (L/100 km) · L/h' : 'L/h · g/kWh',
                capacityLabelEs: 'Capacidad estanque combustible',
                capacityUnitSi: 'L',
            };
    }
}

const FRONTEND_HYBRID_CAPACITY_LABEL_REGEX =
    /\b(estanque\s*\/\s*bater[ií]a|estanque\s*\/\s*carga|tanque\s*\/\s*bater[ií]a|combustible\s*\/\s*bater[ií]a)\b/i;
const FRONTEND_HYBRID_CONSUMPTION_LABEL_REGEX =
    /^(consumo\s+nominal|consumo\s*\/\s*demanda.*|consumo\s+auxiliar\s*\/\s*tracci[oó]n)$/i;

export function normalizeFrontendSlotsByEnergy(
    slots: CanonicalSpecSlot[],
    context?: {
        typeContextText?: string | null;
        primaryEnergy?: string | null;
        energyValueText?: string | null;
    }
): CanonicalSpecSlot[] {
    if (!Array.isArray(slots) || slots.length === 0) return [];
    const sourceSlot = slots.find(
        (s) =>
            s &&
            (s.axis_key === 'fuente_energia' || /\bfuente\s+(?:de\s+)?energ[ií]a\b/i.test(s.label_es || '')) &&
            s.value_si &&
            !s.value_si.startsWith('[')
    );
    const semantics = resolveFrontendEnergySemantics({
        energyValueText: context?.energyValueText || sourceSlot?.value_si || null,
        primaryEnergy: context?.primaryEnergy || null,
        typeContextText: context?.typeContextText || null,
    });

    const out: CanonicalSpecSlot[] = [];
    for (const slot of slots) {
        if (!slot) continue;
        const isConsumption =
            slot.axis_key === 'consumo_energetico_nominal' ||
            FRONTEND_HYBRID_CONSUMPTION_LABEL_REGEX.test((slot.label_es || '').trim());
        const isCapacity =
            slot.axis_key === 'capacidad_energetica_autonomia' ||
            FRONTEND_HYBRID_CAPACITY_LABEL_REGEX.test(slot.label_es || '');

        if (isConsumption) {
            if (!semantics.includeConsumptionAxis) continue;
            const rewrite =
                slot.axis_key === 'consumo_energetico_nominal' ||
                FRONTEND_HYBRID_CONSUMPTION_LABEL_REGEX.test((slot.label_es || '').trim());
            out.push({
                ...slot,
                label_es: rewrite ? semantics.consumptionLabelEs : slot.label_es,
                unit_si: rewrite ? semantics.consumptionUnitSi : slot.unit_si,
            });
            continue;
        }

        if (isCapacity) {
            if (!semantics.includeCapacityAxis || !semantics.capacityLabelEs) continue;
            const rewrite =
                slot.axis_key === 'capacidad_energetica_autonomia' ||
                FRONTEND_HYBRID_CAPACITY_LABEL_REGEX.test(slot.label_es || '') ||
                (semantics.energyKind === 'THERMAL_FUEL' && /\bbater[ií]a\b/i.test(slot.label_es || '')) ||
                (semantics.energyKind === 'BATTERY_BEV' && /\b(estanque|tanque|combustible)\b/i.test(slot.label_es || ''));
            out.push({
                ...slot,
                label_es: rewrite ? semantics.capacityLabelEs : slot.label_es,
                unit_si: rewrite && semantics.capacityUnitSi ? semantics.capacityUnitSi : slot.unit_si,
            });
            continue;
        }

        out.push(slot);
    }
    return out;
}

export function normalizeFrontendSpecLinesByEnergy(
    rawLines: string[] | undefined | null,
    context?: {
        energyValueText?: string | null;
        primaryEnergy?: string | null;
        typeContextText?: string | null;
    }
): string[] {
    if (!Array.isArray(rawLines) || rawLines.length === 0) return [];
    const lines = rawLines.map((l) => String(l || '').trim()).filter(Boolean);
    let detectedEnergy = context?.energyValueText || null;
    if (!detectedEnergy) {
        for (const line of lines) {
            const m = line.match(/^fuente\s+(?:de\s+)?energ[ií]a\s*:\s*(.+)$/i);
            if (m && m[1]) {
                detectedEnergy = m[1].trim();
                break;
            }
        }
    }
    const semantics = resolveFrontendEnergySemantics({
        energyValueText: detectedEnergy,
        primaryEnergy: context?.primaryEnergy || null,
        typeContextText: context?.typeContextText || null,
    });

    const out: string[] = [];
    for (const line of lines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx <= 0) {
            out.push(line);
            continue;
        }
        const rawLabel = line.slice(0, colonIdx).trim();
        const rawVal = line.slice(colonIdx + 1).trim();

        if (
            FRONTEND_HYBRID_CAPACITY_LABEL_REGEX.test(rawLabel) ||
            (semantics.energyKind === 'THERMAL_FUEL' && /^capacidad\s+.*bater[ií]a$/i.test(rawLabel)) ||
            (semantics.energyKind === 'BATTERY_BEV' && /^capacidad\s+(?:de\s+)?(?:estanque|tanque)/i.test(rawLabel))
        ) {
            if (!semantics.includeCapacityAxis || !semantics.capacityLabelEs) continue;
            out.push(`${semantics.capacityLabelEs}: ${rawVal}`);
            continue;
        }
        if (!semantics.includeCapacityAxis && /^capacidad\s+(?:de\s+)?(?:estanque|tanque|bater[ií]a)/i.test(rawLabel)) {
            continue;
        }
        if (FRONTEND_HYBRID_CONSUMPTION_LABEL_REGEX.test(rawLabel)) {
            if (!semantics.includeConsumptionAxis) continue;
            out.push(`${semantics.consumptionLabelEs}: ${rawVal}`);
            continue;
        }
        out.push(line);
    }
    return out;
}

const FRONTEND_PURE_NEGATIVE_BULLET_REGEX =
    /^(?:no\s+aplica\b|n\s*\/\s*a\b|sin\s+(?:sistema|equipamiento|adblue|def\b|scr\b|urea|dpf|egr|bater[ií]a\s+de\s+tracci[oó]n|combustible|estanque)|no\s+(?:posee|equipa|requiere|incorpora|utiliza|dispone\s+de|cuenta\s+con)\b|ausencia\s+de\b|inexistencia\s+de\b|exento\s+de\b)/i;

const FRONTEND_INLINE_NEGATIVE_PAREN_REGEX =
    /\(\s*(?:configuraci[oó]n\s+(?:de\s+motor\s+)?sin\s+[^)]+|no\s+aplica[^)]*|sin\s+(?:sistema\s+|uso\s+de\s+|requerir\s+)?(?:scr|adblue|def\b|urea|dpf|egr|doc\b|postratamiento|bater[ií]a\s+de\s+tracci[oó]n|combustible)[^)]*|no\s+(?:posee|equipa|requiere|incorpora)[^)]*|exento\s+de\s+[^)]*|ausencia\s+de\s+[^)]*)\s*\)/gi;

const FRONTEND_TRAILING_NEGATIVE_CLAUSE_REGEX =
    /(?:[,;—–-]\s*|\s+)(?:sin\s+(?:sistema\s+|requerir\s+|necesidad\s+de\s+|uso\s+de\s+)?(?:scr\b|adblue\b|def\b|urea\b|dpf\b|egr\b|doc\b|postratamiento|bater[ií]a\s+de\s+tracci[oó]n|combustible)[a-z0-9/._\s-]*|no\s+(?:posee|equipa|requiere|incorpora)\s+(?:sistema\s+)?(?:scr\b|adblue\b|def\b|urea\b|dpf\b|egr\b)[a-z0-9/._\s-]*|exento\s+de\s+(?:sistema\s+)?(?:scr\b|adblue\b|def\b|urea\b|dpf\b)[a-z0-9/._\s-]*)$/i;

const FRONTEND_TRAILING_FLUFF_REGEX =
    /\s+(?:dise[ñn]ad[oa]\s+para|orientad[oa]\s+a|enfocad[oa]\s+en)\s+(?:reducci[oó]n\s+de\s+ruido\s+y\s+)?(?:confort|comodidad|ergonom[ií]a\s+y\s+confort|mayor\s+productividad|m[aá]xima\s+eficiencia)[^.,;]*$/i;

const FRONTEND_SPECULATIVE_CLAIM_REGEX =
    /\b(?:ciclos?\s+de\s+trabajo\s+continuos?\s+de\s+\d+\s*(?:a|-|–)\s*\d+\s*(?:horas?|h\b)|turno\s+est[aá]ndar\s+de\s+\d+\s*(?:a|-|–)\s*\d+\s*(?:horas?|h\b)|no\s+incurre\s+en\s+costos|comodidad\s+del\s+operador|confort(?:\s+superior|\s+del\s+operador)?|aplicaciones\s+de\s+alta\s+demanda)\b/i;

const FRONTEND_TAUTOLOGICAL_MOBILITY_REGEX =
    /^configuraci[oó]n\s+de\s+[a-z0-9áéíóúüñ\s/-]+\s+para\s+(?:movilidad|desplazamiento|traslado|operaci[oó]n|trabajo)\s+en\s+(?:superficies?|terrenos?|faenas?|obras?)(?:\s+de\s+[a-záéíóúüñ\s]+)?$/i;

const FRONTEND_METRIC_OR_NORM_REGEX =
    /\b(?:\d[\d.,]*\s*(?:kw|hp|kg|t\b|mm|m³|m3|l\/min|l\/h|bar|mpa|psi|kva|kwh|v\b|hz|dba|db|°c)|iso|sae|din|iec|epa|tier|stage|euro|ip\d{2}|rops|fops|atex|nfpa|xhp|lgp|[468]x[2468]|allison|mdrive|powershift|hidrost[aá]tic[oa]|[a-z]{1,4}\d[a-z0-9.-]*)\b/i;

export function sanitizeFrontendContextLines(
    rawItems: string[] | undefined | null,
    options?: { canonicalTypeEs?: string | null }
): string[] {
    if (!Array.isArray(rawItems) || rawItems.length === 0) return [];
    const normType = options?.canonicalTypeEs
        ? String(options.canonicalTypeEs)
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .toLowerCase()
              .replace(/[.,;:]/g, '')
              .trim()
        : '';

    const out: string[] = [];
    for (const item of rawItems) {
        const rawTrimmed = String(item || '')
            .replace(/^[•\-*]\s*/, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (!rawTrimmed) continue;
        if (rawTrimmed.startsWith('[')) continue;
        if (FRONTEND_PURE_NEGATIVE_BULLET_REGEX.test(rawTrimmed)) continue;

        const clean = rawTrimmed
            .replace(FRONTEND_INLINE_NEGATIVE_PAREN_REGEX, '')
            .replace(FRONTEND_TRAILING_NEGATIVE_CLAUSE_REGEX, '')
            .replace(FRONTEND_TRAILING_FLUFF_REGEX, '')
            .replace(/\s+de\s+alto\s+rendimiento(?=\s*\([A-Z0-9]{2,6}\))/gi, '')
            .replace(/\s+para\s+gesti[oó]n\s+de\s+flujo\s+en\s+aplicaciones\s+de\s+alta\s+demanda$/i, '')
            .replace(/\s{2,}/g, ' ')
            .replace(/[,;—–-]\s*$/, '')
            .trim();
        if (!clean || FRONTEND_PURE_NEGATIVE_BULLET_REGEX.test(clean)) continue;
        if (FRONTEND_SPECULATIVE_CLAIM_REGEX.test(clean)) continue;

        const hasMetricOrNorm = FRONTEND_METRIC_OR_NORM_REGEX.test(clean);
        if (!hasMetricOrNorm && FRONTEND_TAUTOLOGICAL_MOBILITY_REGEX.test(clean)) continue;

        const norm = clean
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[.,;:]/g, '')
            .trim();
        if (
            normType &&
            normType.length >= 6 &&
            !hasMetricOrNorm &&
            (norm === normType || norm.startsWith(`configuracion de ${normType}`))
        ) {
            continue;
        }
        out.push(clean);
    }

    return out.length > 0 ? out : [MISSING_TECH_SPEC];
}

function detectRecordEnergyContext(record: {
    canonical_specs?: CanonicalSpecSlot[] | Record<string, any> | null;
    caracteristicas_principales?: string[];
    short_description?: string;
    physical_traits?: { primary_energy_source?: string | null } | null;
}): { primaryEnergy: string | null; energyValueText: string | null } {
    const primaryEnergy = record.physical_traits?.primary_energy_source || null;
    let energyValueText: string | null = null;

    if (Array.isArray(record.canonical_specs)) {
        const energySlot = record.canonical_specs.find(
            (s) =>
                s &&
                (s.axis_key === 'fuente_energia' || /\bfuente\s+(?:de\s+)?energ[ií]a\b/i.test(s.label_es || '')) &&
                s.value_si &&
                !String(s.value_si).startsWith('[')
        );
        if (energySlot?.value_si) {
            energyValueText = String(energySlot.value_si).trim();
        }
    } else if (record.canonical_specs && typeof record.canonical_specs === 'object') {
        const rawEnergy = (record.canonical_specs as Record<string, any>).fuente_energia;
        const candidate = typeof rawEnergy === 'object' && rawEnergy !== null ? rawEnergy.value_si : rawEnergy;
        if (candidate && !String(candidate).startsWith('[')) {
            energyValueText = String(candidate).trim();
        }
    }

    if (!energyValueText) {
        const candidateLines = [
            ...(Array.isArray(record.caracteristicas_principales)
                ? record.caracteristicas_principales.map((l) => String(l || '').trim()).filter(Boolean)
                : []),
            ...(record.short_description
                ? String(record.short_description)
                      .split('·')
                      .map((t) => t.trim())
                      .filter(Boolean)
                : []),
        ];
        const energyKeyRegex =
            /\b(fuente\s+(?:de\s+)?energ[ií]a|tipo\s+de\s+(?:combustible|energ[ií]a)|combustible|alimentaci[oó]n\s+energ[eé]tica)\b/i;
        for (const line of candidateLines) {
            if (FORBIDDEN_MARKETING_OR_UNVERIFIED_CLAIM_REGEX.test(line)) continue;
            for (const seg of line.split(/\s*[—–]\s*/)) {
                if (!energyKeyRegex.test(seg)) continue;
                const colonIdx = seg.indexOf(':');
                const valCandidate = colonIdx > 0 ? seg.slice(colonIdx + 1).trim() : seg.trim();
                const canon = normalizeCanonicalEnergyEnumLabel(valCandidate);
                if (canon) {
                    energyValueText = canon;
                    break;
                }
            }
            if (energyValueText) break;
        }
    }

    return { primaryEnergy, energyValueText };
}

export function extractHomologousAxisValues(record: {
    equipment_type_key?: string;
    archetype_id?: string;
    tipo_equipo?: string;
    categoria_equipo?: string;
    canonical_specs?: CanonicalSpecSlot[] | Record<string, any> | null;
    caracteristicas_principales?: string[];
    short_description?: string;
    physical_traits?: { primary_energy_source?: string | null } | null;
}): { archetype: ArchetypeDefinition; slots: CanonicalSpecSlot[] } {
    const typeContextText = `${record.equipment_type_key || ''} ${record.tipo_equipo || ''} ${record.categoria_equipo || ''}`;
    const detectedEnergy = detectRecordEnergyContext(record);
    const explicitArch =
        record.archetype_id && record.archetype_id in ARCHETYPE_DEFINITIONS
            ? withResolvedArchetypeEnergyAxes(
                  ARCHETYPE_DEFINITIONS[record.archetype_id as MachineryArchetypeId],
                  {
                      primaryEnergy: detectedEnergy.primaryEnergy,
                      energyValueText: detectedEnergy.energyValueText,
                      typeContextText,
                  }
              )
            : null;
    const baseArchetype =
        explicitArch ||
        resolveMachineryArchetype(record.tipo_equipo, record.categoria_equipo, detectedEnergy);

    // RUTA PRIMARIA: Esquema auto-descriptivo propio del `TIPO` de equipo (`global_equipment_types/{typeKey}`)
    if (hasSelfDescribingTypeSchema(record)) {
        const legacyLines = Array.isArray(record.caracteristicas_principales)
            ? record.caracteristicas_principales.map((l) => String(l || '').trim()).filter(Boolean)
            : [];

        const dynamicAxes: ArchetypeAxisDefinition[] = [];
        const dynamicSlots: CanonicalSpecSlot[] = [];

        for (const item of record.canonical_specs) {
            if (!item || typeof item.axis_key !== 'string' || typeof item.label_es !== 'string') continue;

            const knownStaticAxis = baseArchetype.axes.find((a) => a.axis_key === item.axis_key);
            let cleaned =
                item.value_kind || Array.isArray(item.allowed_enum_values)
                    ? cleanDynamicAxisValue(item.value_si, item)
                    : knownStaticAxis
                        ? cleanCanonicalAxisValue(item.value_si, knownStaticAxis)
                        : cleanDynamicAxisValue(item.value_si, { value_kind: 'PHYSICAL_MAGNITUDE' });

            if (!cleaned && legacyLines.length > 0) {
                const escapedLabel = item.label_es.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const labelRegex = new RegExp(`^${escapedLabel}\\s*:`, 'i');
                for (const line of legacyLines) {
                    if (FORBIDDEN_MARKETING_OR_UNVERIFIED_CLAIM_REGEX.test(line)) continue;
                    if (ACCESSORY_HISTORICAL_SPEC_REGEX.test(line)) continue;
                    if (labelRegex.test(line)) {
                        cleaned = cleanDynamicAxisValue(line, item);
                        if (cleaned) break;
                    }
                }
            }

            const isMandatory = item.mandatory !== false;
            dynamicAxes.push({
                axis_key: item.axis_key,
                label_es: item.label_es,
                unit_hint: item.unit_si || knownStaticAxis?.unit_hint || '',
                mandatory: isMandatory,
                legacyKeyPattern: knownStaticAxis?.legacyKeyPattern || new RegExp(item.axis_key, 'i'),
                validValuePattern: knownStaticAxis?.validValuePattern || ANY_ENGINEERING_METRIC_REGEX,
            });

            dynamicSlots.push({
                axis_key: item.axis_key,
                label_es: item.label_es,
                value_si: cleaned,
                unit_si: item.unit_si,
                mandatory: isMandatory,
                is_differentiator: item.is_differentiator,
                value_kind: item.value_kind,
                allowed_enum_values: item.allowed_enum_values,
                source_url: cleaned ? item.source_url || null : null,
                verbatim_evidence: cleaned ? item.verbatim_evidence || null : null,
            });
        }

        const normalizedDynamicSlots = normalizeFrontendSlotsByEnergy(dynamicSlots, {
            typeContextText,
            primaryEnergy: detectedEnergy.primaryEnergy,
            energyValueText: detectedEnergy.energyValueText,
        });
        if (normalizedDynamicSlots.length >= 2) {
            const alignedAxes = normalizedDynamicSlots.map((ns) => {
                const origAx = dynamicAxes.find((a) => a.axis_key === ns.axis_key);
                return {
                    axis_key: ns.axis_key,
                    label_es: ns.label_es,
                    unit_hint: ns.unit_si || origAx?.unit_hint || '',
                    mandatory: ns.mandatory !== false,
                    legacyKeyPattern: origAx?.legacyKeyPattern || new RegExp(ns.axis_key, 'i'),
                    validValuePattern: origAx?.validValuePattern || ANY_ENGINEERING_METRIC_REGEX,
                };
            });
            return {
                archetype: {
                    id: baseArchetype.id,
                    name_es: String(record.tipo_equipo || baseArchetype.name_es),
                    axes: alignedAxes,
                },
                slots: normalizedDynamicSlots,
            };
        }
    }

    const archetype = baseArchetype;

    const byKey = new Map<
        string,
        { value_si: string | null; source_url?: string | null; verbatim_evidence?: string | null }
    >();

    // 1. Leer primero desde `canonical_specs` estructurado cuando exista
    if (Array.isArray(record.canonical_specs)) {
        for (const item of record.canonical_specs) {
            if (!item || typeof item.axis_key !== 'string') continue;
            const axisDef = archetype.axes.find((a) => a.axis_key === item.axis_key);
            const cleaned = cleanCanonicalAxisValue(item.value_si, axisDef);
            if (cleaned) {
                byKey.set(item.axis_key, {
                    value_si: cleaned,
                    source_url: item.source_url || null,
                    verbatim_evidence: item.verbatim_evidence || null,
                });
            }
        }
    } else if (record.canonical_specs && typeof record.canonical_specs === 'object') {
        for (const [k, rawObj] of Object.entries(record.canonical_specs)) {
            const axisDef = archetype.axes.find((a) => a.axis_key === k);
            const rawVal = typeof rawObj === 'object' && rawObj !== null ? (rawObj as any).value_si : rawObj;
            const cleaned = cleanCanonicalAxisValue(rawVal, axisDef);
            if (cleaned) {
                byKey.set(k, {
                    value_si: cleaned,
                    source_url: typeof rawObj === 'object' && rawObj !== null ? (rawObj as any).source_url || null : null,
                });
            }
        }
    }

    // 2. Rescate determinista desde `caracteristicas_principales[]` y/o `short_description` previo
    const shortDescTokens = record.short_description
        ? String(record.short_description)
            .split('·')
            .map((t) => t.trim())
            .filter(Boolean)
        : [];

    const legacyLines = [
        ...(Array.isArray(record.caracteristicas_principales)
            ? record.caracteristicas_principales.map((l) => String(l || '').trim()).filter(Boolean)
            : []),
        ...shortDescTokens,
    ];

    for (const axis of archetype.axes) {
        if (byKey.has(axis.axis_key)) continue;

        for (const line of legacyLines) {
            if (FORBIDDEN_MARKETING_OR_UNVERIFIED_CLAIM_REGEX.test(line)) continue;
            if (ACCESSORY_HISTORICAL_SPEC_REGEX.test(line)) continue;

            const segments = line.split(/\s*[—–]\s*/);
            for (const seg of segments) {
                if (!axis.legacyKeyPattern.test(seg)) continue;
                const cleaned = cleanCanonicalAxisValue(seg, axis);
                if (cleaned) {
                    byKey.set(axis.axis_key, { value_si: cleaned, source_url: null });
                    break;
                }
            }
            if (byKey.has(axis.axis_key)) break;
        }
    }

    // 3. Cinemática discreta cerrada en Minicargadores únicamente desde campos técnicos no contaminados
    if (archetype.id === 'MINICARGADOR_SSL_CTL' && !byKey.has('cinematica_levante')) {
        const kin = inferDiscreteSkidSteerKinematics(record as Record<string, any>);
        if (kin) {
            byKey.set('cinematica_levante', { value_si: kin, source_url: null });
        }
    }

    const rawFallbackSlots: CanonicalSpecSlot[] = archetype.axes.map((axis) => {
        const hit = byKey.get(axis.axis_key);
        return {
            axis_key: axis.axis_key,
            label_es: axis.label_es,
            value_si: hit?.value_si || null,
            unit_si: axis.unit_hint,
            mandatory: axis.mandatory,
            source_url: hit?.source_url || null,
            verbatim_evidence: hit?.verbatim_evidence || null,
        };
    });

    const slots = normalizeFrontendSlotsByEnergy(rawFallbackSlots, {
        typeContextText,
        primaryEnergy: detectedEnergy.primaryEnergy,
        energyValueText: detectedEnergy.energyValueText,
    });
    const alignedFallbackAxes = slots.map((ns) => {
        const origAx = archetype.axes.find((a) => a.axis_key === ns.axis_key);
        return {
            axis_key: ns.axis_key,
            label_es: ns.label_es,
            unit_hint: ns.unit_si || origAx?.unit_hint || '',
            mandatory: ns.mandatory !== false,
            legacyKeyPattern: origAx?.legacyKeyPattern || new RegExp(ns.axis_key, 'i'),
            validValuePattern: origAx?.validValuePattern || ANY_ENGINEERING_METRIC_REGEX,
        };
    });

    return {
        archetype: {
            ...archetype,
            axes: alignedFallbackAxes,
        },
        slots,
    };
}

export function validateCrossAxisPhysicalPlausibility(
    archetypeId: MachineryArchetypeId,
    slots: CanonicalSpecSlot[]
): { valid: boolean; rejectedAxes: string[]; warnings: string[] } {
    const warnings: string[] = [];
    const rejectedAxes: string[] = [];

    const parseNumberKgOrMm = (raw: string | null | undefined): number | null => {
        if (!raw) return null;
        const m = raw.match(/(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)/);
        if (!m) return null;
        const token = m[1];
        if (/^\d{1,3}(\.\d{3})+$/.test(token)) {
            return Number(token.replace(/\./g, ''));
        }
        if (/^\d{1,3}(,\d{3})+$/.test(token)) {
            return Number(token.replace(/,/g, ''));
        }
        return Number(token.replace(',', '.'));
    };

    const getSlot = (key: string) => slots.find((s) => s.axis_key === key)?.value_si || null;

    if (archetypeId === 'MINICARGADOR_SSL_CTL') {
        const roc = parseNumberKgOrMm(getSlot('capacidad_nominal_roc'));
        const weight = parseNumberKgOrMm(getSlot('peso_operativo'));
        const dumpMm = parseNumberKgOrMm(getSlot('altura_max_descarga'));

        if (roc !== null && weight !== null && weight > 300 && roc > weight * 0.72) {
            warnings.push(
                `ROC inverosímil (${roc} kg) respecto al peso operativo (${weight} kg) bajo ISO 14397.`
            );
            rejectedAxes.push('capacidad_nominal_roc');
        }
        if (dumpMm !== null && (dumpMm < 1100 || dumpMm > 4200)) {
            warnings.push(
                `Altura máxima de descarga fuera de envolvente física de minicargador (${dumpMm} mm).`
            );
            rejectedAxes.push('altura_max_descarga');
        }
    }

    if (archetypeId === 'BULLDOZER_ORUGAS') {
        const blade = parseNumberKgOrMm(getSlot('capacidad_hoja'));
        if (blade !== null && (blade < 0.8 || blade > 85)) {
            warnings.push(`Capacidad volumétrica de hoja fuera de rango físico (${blade} m³).`);
            rejectedAxes.push('capacidad_hoja');
        }
    }

    return {
        valid: rejectedAxes.length === 0,
        rejectedAxes,
        warnings,
    };
}

/**
 * Construye la línea descriptiva homóloga e invariante del equipo para `CATÁLOGO` y `FLOTA`:
 * - Siempre presenta los mismos ejes obligatorios del arquetipo en el MISMO orden fijo para comparación 1 a 1.
 * - Ignora 100% cualquier prosa libre (`caracteristica_diferenciadora`) y bloquea afirmaciones comerciales.
 * - Cero truncamiento (`.slice` prohibido).
 */
export function buildHomologousEquipmentDescription(record: {
    equipment_type_key?: string;
    archetype_id?: string;
    tipo_equipo?: string;
    categoria_equipo?: string;
    canonical_specs?: CanonicalSpecSlot[] | Record<string, any> | null;
    caracteristicas_principales?: string[];
    short_description?: string;
}): string {
    const { slots } = extractHomologousAxisValues(record);

    const hasAnyVerifiedValue = slots.some((s) => Boolean(s.value_si));
    if (!hasAnyVerifiedValue) {
        return MISSING_TECH_SPEC;
    }

    const renderedParts: string[] = [];
    for (const slot of slots) {
        if (slot.mandatory) {
            renderedParts.push(`${slot.label_es}: ${slot.value_si || MISSING_AXIS_VALUE}`);
        } else if (slot.value_si) {
            renderedParts.push(`${slot.label_es}: ${slot.value_si}`);
        }
    }

    return renderedParts.join(' · ');
}

export function formatTransmissionCategoryShortEs(category?: string | null): string | null {
    switch (category) {
        case 'AUTOMATIC_PLANETARY_CONVERTER':
        case 'AUTOMATIC_TORQUE_CONVERTER':
            return 'Automática';
        case 'AUTOMATED_MANUAL_AMT':
        case 'AMT_AUTOMATED':
            return 'Automatizada (AMT)';
        case 'MANUAL_UNSYNCHRONIZED_FULLER':
        case 'MANUAL_FULLER_NON_SYNCHRO':
            return 'Manual Eaton Fuller';
        case 'MANUAL_SYNCHRONIZED':
        case 'MANUAL_SYNCHRO':
            return 'Manual';
        case 'POWERSHIFT':
            return 'Powershift';
        case 'HYDROSTATIC':
            return 'Hidrostática';
        case 'ELECTRIC_DRIVE':
        case 'ELECTRIC_AC_DC':
            return 'Eléctrica AC/DC';
        case 'DIRECT_MECHANICAL':
        case 'DIRECT_DRIVE_OR_REDUCER':
            return 'Accionamiento directo';
        default:
            return null;
    }
}

export function buildEquipmentShortDescription(record: {
    equipment_type_key?: string;
    archetype_id?: string;
    canonical_specs?: CanonicalSpecSlot[] | Record<string, any> | null;
    configuration_profile?: {
        axle_or_undercarriage_config?: string | null;
        transmission_category?: string | null;
        transmission_model_spec?: string | null;
        work_body_or_implement?: string | null;
        factory_emission_or_grid_spec?: string | null;
    } | null;
    short_description?: string;
    tipo_equipo?: string;
    categoria_equipo?: string;
    contexto_operativo?: string[];
    caracteristicas_principales?: string[];
}): string {
    const base = buildHomologousEquipmentDescription(record);
    const cfg = record.configuration_profile;
    if (!cfg) return base;

    const baseUpper = base.toUpperCase();
    const extras: string[] = [];

    if (
        cfg.axle_or_undercarriage_config &&
        !baseUpper.includes(cfg.axle_or_undercarriage_config.toUpperCase())
    ) {
        extras.push(`Ejes/Rodaje: ${cfg.axle_or_undercarriage_config}`);
    }
    const txText = cfg.transmission_model_spec || formatTransmissionCategoryShortEs(cfg.transmission_category);
    if (txText && !baseUpper.includes(txText.toUpperCase().slice(0, 10))) {
        extras.push(`Caja: ${txText}`);
    }
    if (cfg.work_body_or_implement && !baseUpper.includes(cfg.work_body_or_implement.toUpperCase().slice(0, 10))) {
        extras.push(`Config.: ${cfg.work_body_or_implement}`);
    }
    if (extras.length === 0) return base;
    if (!base || base === MISSING_TECH_SPEC) return extras.join(' · ');
    return `${base} · ${extras.join(' · ')}`;
}

export function countPublishedPillars(
    knowledgeVault: Record<string, any> | null | undefined
): number {
    if (!knowledgeVault || typeof knowledgeVault !== 'object') return 0;

    let count = 0;
    for (const pillarId of VALID_PILLARS) {
        const pillarDoc = knowledgeVault[pillarId];
        const items: any[] = Array.isArray(pillarDoc?.items) ? pillarDoc.items : [];
        const hasApprovedHuman = items.some(
            (it) =>
                !it?.is_discarded &&
                it?.content_status === 'COMPLETADO' &&
                it?.estado_aprobacion === 'APROBADO_HUMANO' &&
                Boolean(String(it?.content || '').trim())
        );
        if (hasApprovedHuman) count++;
    }
    return count;
}

export function sortEquipmentByBrandAndType<T extends SortableEquipmentRecord>(records: T[]): T[] {
    return [...records].sort((a, b) => {
        const makeA = String(a.make_oficial || a.make || '').trim();
        const makeB = String(b.make_oficial || b.make || '').trim();
        const byMake = textCollator.compare(makeA, makeB);
        if (byMake !== 0) return byMake;

        const typeA = cleanMachineryTypeLabel(a.tipo_equipo || a.categoria_equipo);
        const typeB = cleanMachineryTypeLabel(b.tipo_equipo || b.categoria_equipo);
        const byType = textCollator.compare(typeA, typeB);
        if (byType !== 0) return byType;

        const modelA = String(a.model_oficial || a.model || '').trim();
        const modelB = String(b.model_oficial || b.model || '').trim();
        const byModel = numericCollator.compare(modelA, modelB);
        if (byModel !== 0) return byModel;

        const serialA = String(a.serial_number || a.identifier_value || '').trim();
        const serialB = String(b.serial_number || b.identifier_value || '').trim();
        return numericCollator.compare(serialA, serialB);
    });
}

export function groupEquipmentByBrandAndType<T extends SortableEquipmentRecord>(
    records: T[]
): EquipmentBrandTypeGroup<T>[] {
    const sorted = sortEquipmentByBrandAndType(records);
    const groups: EquipmentBrandTypeGroup<T>[] = [];
    const indexByKey = new Map<string, number>();

    for (const item of sorted) {
        const rawBrand = String(item.make_oficial || item.make || '').trim();
        const cleanedType = cleanMachineryTypeLabel(item.tipo_equipo || item.categoria_equipo);

        const brandLabel = rawBrand ? rawBrand.toUpperCase() : MISSING_TECH_SPEC;
        const machineryTypeLabel =
            cleanedType && !cleanedType.startsWith('[')
                ? cleanedType.toUpperCase()
                : MISSING_TECH_SPEC;
        const groupKey = `${brandLabel}::${machineryTypeLabel}`;

        const existingIdx = indexByKey.get(groupKey);
        if (existingIdx !== undefined) {
            groups[existingIdx].items.push(item);
        } else {
            indexByKey.set(groupKey, groups.length);
            groups.push({
                groupKey,
                brandLabel,
                machineryTypeLabel,
                items: [item],
            });
        }
    }

    return groups;
}
