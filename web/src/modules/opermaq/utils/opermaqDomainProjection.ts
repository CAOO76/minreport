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

const ARCHETYPE_UNIVERSAL_ENERGY_AXES: ArchetypeAxisDefinition[] = [
    {
        axis_key: 'fuente_energia',
        label_es: 'Fuente energía',
        unit_hint: 'Diésel | Gasolina | Eléctrico | Híbrido | GLP/GNV | Neumático',
        mandatory: false,
        legacyKeyPattern: /\b(fuente\s+de\s+energ[ií]a|tipo\s+de\s+(?:combustible|energ[ií]a)|combustible|alimentaci[oó]n\s+energ[eé]tica)\b/i,
        validValuePattern: ENERGY_SOURCE_VALUE_REGEX,
    },
    {
        axis_key: 'consumo_energetico_nominal',
        label_es: 'Consumo nominal',
        unit_hint: 'L/h / km/L (L/100 km) / g/kWh / kWh/h / L/s',
        mandatory: false,
        legacyKeyPattern: /\b(consumo\s+(?:energ[eé]tico|nominal|de\s+combustible|espec[ií]fico|horario|el[eé]ctrico|de\s+aire)|rendimiento\s+de\s+combustible|bsfc)\b/i,
        validValuePattern: NUM_UNIT_ENERGY_CONSUMPTION,
    },
    {
        axis_key: 'capacidad_energetica_autonomia',
        label_es: 'Capacidad estanque / batería',
        unit_hint: 'L / kWh (Autonomía h / km)',
        mandatory: false,
        legacyKeyPattern: /\b(capacidad\s+(?:de\s+)?(?:estanque|tanque\s+de\s+combustible|bater[ií]a)|estanque\s+de\s+combustible|autonom[ií]a)\b/i,
        validValuePattern: NUM_UNIT_ENERGY_CAPACITY,
    },
];

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
            ...ARCHETYPE_UNIVERSAL_ENERGY_AXES,
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
            ...ARCHETYPE_UNIVERSAL_ENERGY_AXES,
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
            ...ARCHETYPE_UNIVERSAL_ENERGY_AXES,
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
            ...ARCHETYPE_UNIVERSAL_ENERGY_AXES,
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
            ...ARCHETYPE_UNIVERSAL_ENERGY_AXES,
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
            ...ARCHETYPE_UNIVERSAL_ENERGY_AXES,
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
            ...ARCHETYPE_UNIVERSAL_ENERGY_AXES,
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
            ...ARCHETYPE_UNIVERSAL_ENERGY_AXES,
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
            ...ARCHETYPE_UNIVERSAL_ENERGY_AXES,
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
            ...ARCHETYPE_UNIVERSAL_ENERGY_AXES,
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
            ...ARCHETYPE_UNIVERSAL_ENERGY_AXES,
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
            ...ARCHETYPE_UNIVERSAL_ENERGY_AXES,
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
            ...ARCHETYPE_UNIVERSAL_ENERGY_AXES,
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
            ...ARCHETYPE_UNIVERSAL_ENERGY_AXES,
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
    categoriaEquipo?: string | null
): ArchetypeDefinition {
    const combined = `${tipoEquipo || ''} ${categoriaEquipo || ''}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    if (/\b(minicargador|skid\s*steer|cargador\s+compacto|compact\s+track\s+loader|\bssl\b|\bctl\b)\b/.test(combined)) {
        return ARCHETYPE_DEFINITIONS.MINICARGADOR_SSL_CTL;
    }
    if (/\b(bulldozer|tractor\s+topador|tractor\s+sobre\s+orugas|tractor\s+de\s+cadenas|dozer)\b/.test(combined)) {
        if (/\b(neumatic|ruedas|wheel\s+dozer)\b/.test(combined)) {
            return ARCHETYPE_DEFINITIONS.BULLDOZER_NEUMATICOS;
        }
        return ARCHETYPE_DEFINITIONS.BULLDOZER_ORUGAS;
    }
    if (/\b(retroexcavadora|backhoe)\b/.test(combined)) {
        return ARCHETYPE_DEFINITIONS.RETROEXCAVADORA;
    }
    if (/\b(excavadora|pala\s+hidraulica|pala\s+electrica|pala\s+de\s+cables)\b/.test(combined)) {
        return ARCHETYPE_DEFINITIONS.EXCAVADORA_HIDRAULICA;
    }
    if (/\b(cargador\s+frontal|cargador\s+sobre\s+ruedas|cargador\s+de\s+ruedas|scooptram|\blhd\b|wheel\s+loader)\b/.test(combined)) {
        return ARCHETYPE_DEFINITIONS.CARGADOR_FRONTAL;
    }
    if (/\b(camion\s+(?:minero|caex|extraccion|tolva|volquete|articulado|aljibe|batea)|caex|dumper|volquete)\b/.test(combined)) {
        return ARCHETYPE_DEFINITIONS.CAMION_TOLVA_CAEX;
    }
    if (/\b(motoniveladora|motor\s*grader)\b/.test(combined)) {
        return ARCHETYPE_DEFINITIONS.MOTONIVELADORA;
    }
    if (/\b(compactador|rodillo\s+vibratorio|rodillo\s+compactador|placa\s+compactadora)\b/.test(combined)) {
        return ARCHETYPE_DEFINITIONS.COMPACTADOR_RODILLO;
    }
    if (/\b(grua|camion\s+pluma|manipulador\s+telescopico|telehandler|horquilla|montacargas|alza\s*hombre|manlift)\b/.test(combined)) {
        return ARCHETYPE_DEFINITIONS.GRUA_IZAJE_MANIPULADOR;
    }
    if (/\b(perforadora|jackleg|stopper|jumbo|sondaje|martillo\s+neumatico|drill|simba|roc\b)\b/.test(combined)) {
        return ARCHETYPE_DEFINITIONS.PERFORADORA_SONDAJE;
    }
    if (/\b(compresor|generador|grupo\s+electrogeno|motobomba|bomba\s+centrifuga|soldadora|torre\s+de\s+iluminacion)\b/.test(combined)) {
        return ARCHETYPE_DEFINITIONS.COMPRESOR_GENERADOR_BOMBA;
    }
    if (
        /\b(camioneta|pick[- ]?up|tractocamion|furgon|furgoneta|van|minivan|bus|minibus|autobus|suv|crossover|automovil|sedan|hatchback|citycar|station\s+wagon|todo\s*terreno|4x4|ambulancia|motocicleta|moto\b|cuatrimoto|atv|utv|vehiculo|camion\s+(?:3\/4|plano|cerrado|reparto|forestal|combustible|lubricador))\b/.test(
            combined
        )
    ) {
        return ARCHETYPE_DEFINITIONS.VEHICULO_LIVIANO_TRANSPORTE;
    }

    return ARCHETYPE_DEFINITIONS.HERRAMIENTA_INDUSTRIAL_GENERAL;
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

    if (axisMeta?.axis_key === 'fuente_energia' || /^(fuente_energia|tipo_combustible|tipo_energia)$/i.test(String(axisMeta?.axis_key || ''))) {
        const canonEnergy = normalizeCanonicalEnergyEnumLabel(valueOnly);
        if (canonEnergy) return canonEnergy;
    }

    if (axisMeta?.value_kind === 'CLOSED_ENUM' && Array.isArray(axisMeta.allowed_enum_values) && axisMeta.allowed_enum_values.length > 0) {
        const canonEnergy = normalizeCanonicalEnergyEnumLabel(valueOnly);
        if (canonEnergy && axisMeta.allowed_enum_values.includes(canonEnergy)) {
            return canonEnergy;
        }

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

    if (/^(?:[2468]x[2468]|awd|4wd|2wd|fwd|rwd|levante\s+(?:vertical|radial))$/i.test(valueOnly)) {
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

export function extractHomologousAxisValues(record: {
    equipment_type_key?: string;
    archetype_id?: string;
    tipo_equipo?: string;
    categoria_equipo?: string;
    canonical_specs?: CanonicalSpecSlot[] | Record<string, any> | null;
    caracteristicas_principales?: string[];
    short_description?: string;
}): { archetype: ArchetypeDefinition; slots: CanonicalSpecSlot[] } {
    const explicitArch =
        record.archetype_id && record.archetype_id in ARCHETYPE_DEFINITIONS
            ? ARCHETYPE_DEFINITIONS[record.archetype_id as MachineryArchetypeId]
            : null;
    const baseArchetype = explicitArch || resolveMachineryArchetype(record.tipo_equipo, record.categoria_equipo);

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

        if (dynamicSlots.length >= 2) {
            return {
                archetype: {
                    id: baseArchetype.id,
                    name_es: String(record.tipo_equipo || baseArchetype.name_es),
                    axes: dynamicAxes,
                },
                slots: dynamicSlots,
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

    const slots: CanonicalSpecSlot[] = archetype.axes.map((axis) => {
        const hit = byKey.get(axis.axis_key);
        return {
            axis_key: axis.axis_key,
            label_es: axis.label_es,
            value_si: hit?.value_si || null,
            source_url: hit?.source_url || null,
            verbatim_evidence: hit?.verbatim_evidence || null,
        };
    });

    return { archetype, slots };
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
    const { archetype, slots } = extractHomologousAxisValues(record);

    const hasAnyVerifiedValue = slots.some((s) => Boolean(s.value_si));
    if (!hasAnyVerifiedValue) {
        return MISSING_TECH_SPEC;
    }

    const renderedParts: string[] = [];
    for (let i = 0; i < archetype.axes.length; i++) {
        const axisDef = archetype.axes[i];
        const slot = slots[i];
        if (axisDef.mandatory) {
            renderedParts.push(`${axisDef.label_es}: ${slot.value_si || MISSING_AXIS_VALUE}`);
        } else if (slot.value_si) {
            renderedParts.push(`${axisDef.label_es}: ${slot.value_si}`);
        }
    }

    return renderedParts.join(' · ');
}

export function buildEquipmentShortDescription(record: {
    equipment_type_key?: string;
    archetype_id?: string;
    canonical_specs?: CanonicalSpecSlot[] | Record<string, any> | null;
    short_description?: string;
    tipo_equipo?: string;
    categoria_equipo?: string;
    contexto_operativo?: string[];
    caracteristicas_principales?: string[];
}): string {
    return buildHomologousEquipmentDescription(record);
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
