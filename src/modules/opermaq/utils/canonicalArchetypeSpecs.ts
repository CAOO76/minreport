/**
 * MOTOR DETERMINISTA DE HOMOLOGACIÓN POR ARQUETIPO Y CORTAFUEGOS ANTI-MARKETING (OPERMAQ)
 *
 * Cumplimiento estricto GEMINI.md (§3.1, §3.2 y Capa 4):
 * 1. Prohibida la prosa publicitaria, calificativos comerciales y afirmaciones operacionales no verificadas
 *    (ej. "mayor alcance para carga de camiones", "fácil carga", "alta eficiencia", "líder en su clase").
 * 2. Todos los equipos del mismo arquetipo mecánico exponen exactamente los mismos ejes físicos canónicos
 *    en idéntico orden y unidades SI (`tabular-nums`), garantizando comparabilidad directa 1 a 1.
 * 3. Cualquier eje canónico sin respaldo documental verificado se proyecta honestamente como
 *    `[No declarado en ficha]`; si ningún eje está verificado, se proyecta
 *    `[Información técnica no declarada en ficha]`.
 */

export const MISSING_FULL_TECH_SPEC = '[Información técnica no declarada en ficha]';
export const MISSING_AXIS_VALUE = '[No declarado en ficha]';

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
    | 'PLANTA_MOVIL_CHANCADO_HARNERO'
    | 'REMOLQUE_CARRO_ARRASTRE_IMPLEMENTO'
    | 'VEHICULO_LIVIANO_TRANSPORTE'
    | 'HERRAMIENTA_INDUSTRIAL_GENERAL';

export type EquipmentAxisValueKind = 'PHYSICAL_MAGNITUDE' | 'CLOSED_ENUM';

export interface EquipmentTypeAxisSchemaItem {
    axis_key: string;
    label_es: string;
    unit_si: string;
    value_kind: EquipmentAxisValueKind;
    allowed_enum_values?: string[];
    search_keywords: string[];
    mandatory: boolean;
    is_differentiator: boolean;
}

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
    /** Expresión para rescatar determinísticamente el valor desde líneas legacy `caracteristicas_principales` */
    legacyKeyPattern: RegExp;
    /** Expresión para verificar que el valor rescatado contiene una magnitud física real o enumeración técnica cerrada */
    validValuePattern: RegExp;
}

export interface ArchetypeDefinition {
    id: MachineryArchetypeId;
    name_es: string;
    axes: ArchetypeAxisDefinition[];
}

/**
 * Cortafuegos determinista contra prosa de marketing, eslóganes de folletos y afirmaciones falsas o subjetivas.
 */
export const FORBIDDEN_MARKETING_OR_UNVERIFIED_CLAIM_REGEX =
    /\b(carga\s+(?:f[aá]cil\s+)?de\s+camiones|cargu[ií]o\s+de\s+camiones|easier\s+truck\s+loading|truck\s+loading|mayor\s+alcance|alcance\s+extendido|l[ií]der\s+en|insuperable|mejor\s+de\s+su\s+clase|best[- ]in[- ]class|alta\s+eficiencia|m[aá]xima\s+eficiencia|m[aá]xima\s+productividad|[oó]ptimo\s+rendimiento|rendimiento\s+superior|excelente\s+(?:estabilidad|desempe[ñn]o)|gran\s+versatilidad|dise[ñn]ad[oa]\s+para\s+maximizar|proporciona\s+mayor|ofrece\s+mayor|permite\s+cargar\s+camiones|ideal\s+para|f[aá]cil\s+mantenimiento|comodidad\s+del\s+operador|confort(?:\s+superior|\s+del\s+operador)?|aplicaciones\s+de\s+alta\s+demanda|ciclos?\s+de\s+trabajo\s+continuos?\s+de\s+\d+\s*(?:a|-|–)\s*\d+\s*(?:horas?|h\b)|turno\s+est[aá]ndar\s+de\s+\d+\s*(?:a|-|–)\s*\d+\s*(?:horas?|h\b)|no\s+incurre\s+en\s+costos|directiva\s+de\s+c[aá]lculo)\b/i;

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
export const ENERGY_SOURCE_VALUE_REGEX =
    /\b(di[eé]sel(?:\s+ulsd)?|gasolina|bencina|el[eé]ctric[oa](?:\s+(?:red\s+ac|trif[aá]sic[oa]|monof[aá]sic[oa]|bater[ií]a|bev))?|bater[ií]a(?:\s+bev|\s+li-?ion|\s+lfp)?|bev|h[ií]brid[oa](?:\s+di[eé]sel[- ]el[eé]ctric[oa])?|dual[- ]?fuel|glp|gnv|gnl|aire\s+comprimido|neum[aá]tic[oa]|electrohidr[aá]ulic[oa]|hidr[aá]ulic[oa](?:\s+700\s*bar)?|manual(?:\s+mec[aá]nic[oa])?|remolcad[oa]|sin\s+propulsi[oó]n\s+propia|auxiliar\s+12\s*v|auxiliar\s+24\s*v)\b/i;
export const ANY_ENGINEERING_METRIC_REGEX =
    /\b(\d[\d.,]*\s*(?:l\/100\s*km|kwh\/100\s*km|km\/l|g\/kwh|lb\/hp[·.\s-]?h(?:r)?|kwh\/h|kwh\/t|kwh\/ciclo|l\/t|l\/ton|gal\/h|gph|mpg|m³\/min|m³\/h|m3\/min|m3\/h|l\/min|l\/s|l\/h|km\/h|m\/s|kn[·.\s-]?m|t[·.\s-]?m|n[·.\s-]?m|m\.?c\.?a\.?|m³|m²|cm³|yd³|°c|dba|db|lm|lux|mpx|ghz|dbm|ppm|kwh|kva|kw|mw|hp|cv|kgf|kg|toneladas?|ton|lbs?|mm|cm|km|pulg|ft|in|m3|m2|cm3|cc|yd3|litros?|gal|scfm|cfm|gpm|mbar|bar|mpa|kpa|psi|kn|kj|hz|khz|mhz|bpm|rpm|mah|ah|wh|kv|mv|volt|amp|ciclos|vuelos|[tgwvnajmlh%])\b|[2468]x[2468]|\b(?:awd|4wd|2wd|fwd|rwd|[bhnp]q)\b|\d[\d.,]*\s*°)/i;

const ANY_SI_METRIC = ANY_ENGINEERING_METRIC_REGEX;

export const UNIVERSAL_ENERGY_SOURCE_ENUM_VALUES: string[] = [
    'Diésel',
    'Gasolina',
    'Eléctrico Red AC',
    'Eléctrico Batería (BEV)',
    'Híbrido Diésel-Eléctrico',
    'Híbrido Gasolina-Eléctrico',
    'Dual-Fuel Diésel-Gas',
    'GLP / GNV',
    'Neumático (Aire Comprimido)',
    'Electrohidráulico / Hidráulico Auxiliar (incl. 700 bar)',
    'Remolcado / Sin Propulsión Propia (Auxiliar 12V/24V)',
    'Manual / Mecánico (Sin Energía Externa)',
];

const ARCHETYPE_UNIVERSAL_ENERGY_AXES: ArchetypeAxisDefinition[] = [
    {
        axis_key: 'fuente_energia',
        label_es: 'Fuente energía',
        unit_hint: 'Diésel | Gasolina | Eléctrico | Híbrido | GLP/GNV | Neumático',
        mandatory: false,
        legacyKeyPattern: /\b(fuente\s+(?:de\s+)?energ[ií]a|tipo\s+de\s+(?:combustible|energ[ií]a)|combustible|alimentaci[oó]n\s+energ[eé]tica)\b/i,
        validValuePattern: ENERGY_SOURCE_VALUE_REGEX,
    },
    {
        axis_key: 'consumo_energetico_nominal',
        label_es: 'Consumo horario combustible',
        unit_hint: 'L/h · g/kWh',
        mandatory: false,
        legacyKeyPattern: /\b(consumo\s+(?:energ[eé]tico|nominal|de\s+combustible|espec[ií]fico|horario|el[eé]ctrico|de\s+aire)|rendimiento\s+de\s+combustible|potencia\s+el[eé]ctrica\s+absorbida|bsfc)\b/i,
        validValuePattern: NUM_UNIT_ENERGY_CONSUMPTION,
    },
    {
        axis_key: 'capacidad_energetica_autonomia',
        label_es: 'Capacidad estanque combustible',
        unit_hint: 'L',
        mandatory: false,
        legacyKeyPattern: /\b(capacidad\s+(?:de\s+)?(?:estanque|tanque\s+de\s+combustible|banco\s+bater[ií]as|bater[ií]a)|estanque\s+(?:de\s+)?combustible|autonom[ií]a)\b/i,
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
                legacyKeyPattern: /\b(tren\s+de\s+rodaje|rueda\s+(?:motriz|cabilla)|sprocket)\b/i,
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
                axis_key: 'carga_vuelco_estatica',
                label_es: 'Carga estática vuelco',
                unit_hint: 'kg',
                mandatory: false,
                legacyKeyPattern: /\b(carga\s+(?:est[aá]tica\s+(?:de\s+)?)?vuelco|tipping\s+load)\b/i,
                validValuePattern: NUM_UNIT_MASS,
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
                axis_key: 'caudal_presion_hidraulica_aux',
                label_es: 'Hidráulica auxiliar',
                unit_hint: 'L/min @ bar',
                mandatory: false,
                legacyKeyPattern:
                    /\b(hidr[aá]ulic[oa]\s+auxiliar|caudal\s+hidr[aá]ulico|presi[oó]n\s+hidr[aá]ulica|\bxhp\b|high\s+flow)\b/i,
                validValuePattern: NUM_UNIT_FLOW_PRESSURE_ELEC,
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
                axis_key: 'altura_max_descarga',
                label_es: 'Altura máx. descarga',
                unit_hint: 'mm',
                mandatory: true,
                legacyKeyPattern: /\b(altura\s+(?:m[aá]x(?:ima)?\.?\s+(?:de\s+)?)?(?:descarga|volteo|vaciado)|dump\s+clearance)\b/i,
                validValuePattern: NUM_UNIT_LENGTH,
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
                legacyKeyPattern: /\b(profundidad\s+(?:m[aá]x(?:ima)?\.?\s+(?:de\s+)?)?excavaci[oó]n|alcance\s+vertical)\b/i,
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
                legacyKeyPattern: /\b(profundidad\s+(?:m[aá]x(?:ima)?\.?\s+(?:de\s+)?)?excavaci[oó]n)\b/i,
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
                legacyKeyPattern: /\b(capacidad\s+(?:de\s+)?(?:tolva|caja|estanque)|volumen\s+colmado|tolva)\b/i,
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
                legacyKeyPattern: /\b(ancho\s+de\s+(?:compactaci[oó]n|tambor|rodillo)|tambor)\b/i,
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
                legacyKeyPattern: /\b(capacidad\s+(?:m[aá]x(?:ima)?\.?\s+(?:de\s+)?)?(?:carga|izaje|levante)|carga\s+m[aá]xima)\b/i,
                validValuePattern: NUM_UNIT_MASS,
            },
            {
                axis_key: 'altura_o_alcance_max',
                label_es: 'Altura máx. levante',
                unit_hint: 'm / mm',
                mandatory: true,
                legacyKeyPattern: /\b(altura\s+m[aá]x(?:ima)?|alcance\s+m[aá]x(?:imo)?|longitud\s+de\s+pluma)\b/i,
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
                legacyKeyPattern: /\b(di[aá]metro\s+de\s+(?:perforaci[oó]n|broca|barreno)|rango\s+de\s+perforaci[oó]n)\b/i,
                validValuePattern: /\b(\d[\d.,]*\s*(?:mm|pulg|in)|[bhnp]q)\b/i,
            },
            {
                axis_key: 'energia_o_frecuencia_impacto',
                label_es: 'Impacto / Frecuencia',
                unit_hint: 'J / Hz / kW',
                mandatory: true,
                legacyKeyPattern: /\b(energ[ií]a\s+de\s+impacto|frecuencia\s+de\s+impacto|potencia\s+de\s+percusi[oó]n|fuerza\s+de\s+avance|pullback)\b/i,
                validValuePattern: /\b\d[\d.,]*\s*(?:j\b|hz|bpm|kw|kn|n[·\s-]?m)\b/i,
            },
            {
                axis_key: 'consumo_o_potencia',
                label_es: 'Consumo / Potencia',
                unit_hint: 'L/s / kW',
                mandatory: true,
                legacyKeyPattern: /\b(consumo\s+de\s+aire|potencia(\s+instalada|\s+motor)?|presi[oó]n\s+de\s+trabajo)\b/i,
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
                legacyKeyPattern: /\b(caudal(\s+de\s+aire\s+libre)?|potencia\s+(?:prime|continua|nominal|standby)|capacidad\s+nominal)\b/i,
                validValuePattern: NUM_UNIT_FLOW_PRESSURE_ELEC,
            },
            {
                axis_key: 'presion_o_tension_nominal',
                label_es: 'Presión / Tensión',
                unit_hint: 'bar / V',
                mandatory: true,
                legacyKeyPattern: /\b(presi[oó]n\s+(?:nominal|de\s+trabajo)|tensi[oó]n|voltaje|altura\s+manom[eé]trica)\b/i,
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
    PLANTA_MOVIL_CHANCADO_HARNERO: {
        id: 'PLANTA_MOVIL_CHANCADO_HARNERO',
        name_es: 'Planta Móvil de Chancado / Harneado',
        axes: [
            {
                axis_key: 'capacidad_procesamiento',
                label_es: 'Capacidad procesamiento',
                unit_hint: 't/h',
                mandatory: true,
                legacyKeyPattern: /\b(capacidad\s+(?:de\s+)?(?:procesamiento|producci[oó]n|chancado|harneado)|rendimiento\s+en\s+t\/h)\b/i,
                validValuePattern: ANY_SI_METRIC,
            },
            {
                axis_key: 'abertura_alimentacion_o_cribado',
                label_es: 'Abertura / Área cribado',
                unit_hint: 'mm / m²',
                mandatory: true,
                legacyKeyPattern: /\b(abertura\s+(?:de\s+)?alimentaci[oó]n|boca\s+de\s+alimentaci[oó]n|[aá]rea\s+de\s+cribado|superficie\s+de\s+harneado|css\b)\b/i,
                validValuePattern: ANY_SI_METRIC,
            },
            {
                axis_key: 'potencia_neta',
                label_es: 'Potencia motriz',
                unit_hint: 'kW (HP)',
                mandatory: true,
                legacyKeyPattern: /\b(potencia(\s+neta|\s+motor|\s+instalada)?)\b/i,
                validValuePattern: NUM_UNIT_POWER,
            },
            {
                axis_key: 'peso_operativo',
                label_es: 'Peso operativo',
                unit_hint: 'kg',
                mandatory: true,
                legacyKeyPattern: /\b(peso(\s+operativo|\s+de\s+transporte)?|masa)\b/i,
                validValuePattern: NUM_UNIT_MASS,
            },
            ...ARCHETYPE_UNIVERSAL_ENERGY_AXES,
        ],
    },
    REMOLQUE_CARRO_ARRASTRE_IMPLEMENTO: {
        id: 'REMOLQUE_CARRO_ARRASTRE_IMPLEMENTO',
        name_es: 'Remolque / Carro de Arrastre / Estanque Móvil',
        axes: [
            {
                axis_key: 'capacidad_carga_o_volumen',
                label_es: 'Capacidad útil / Estanque',
                unit_hint: 'L / m³ / kg',
                mandatory: true,
                legacyKeyPattern: /\b(capacidad\s+(?:[uú]til|de\s+carga|estanque|tanque|volum[eé]trica)|volumen\s+nominal|carga\s+[uú]til)\b/i,
                validValuePattern: ANY_SI_METRIC,
            },
            {
                axis_key: 'peso_bruto_gvwr',
                label_es: 'Peso bruto (GVWR) / Tara',
                unit_hint: 'kg',
                mandatory: true,
                legacyKeyPattern: /\b(peso\s+(?:bruto|operativo|seco)|gvwr|pvb|tara|masa)\b/i,
                validValuePattern: NUM_UNIT_MASS,
            },
            {
                axis_key: 'configuracion_ejes_rodado',
                label_es: 'Ejes y rodado',
                unit_hint: 'N° ejes / Medida neumático',
                mandatory: true,
                legacyKeyPattern: /\b(ejes?|configuraci[oó]n\s+de\s+ejes|neum[aá]ticos?|rodado|t[aá]ndem)\b/i,
                validValuePattern: ANY_SI_METRIC,
            },
            {
                axis_key: 'caudal_bomba_o_servicio_aux',
                label_es: 'Caudal trasvasije / Auxiliar',
                unit_hint: 'L/min @ 12V/24V',
                mandatory: false,
                legacyKeyPattern: /\b(caudal\s+(?:de\s+)?(?:bomba|trasvasije|dispensador)|bomba\s+auxiliar|tensi[oó]n\s+auxiliar)\b/i,
                validValuePattern: ANY_SI_METRIC,
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

export function resolveMachineryArchetype(
    tipoEquipo?: string | null,
    categoriaEquipo?: string | null
): ArchetypeDefinition {
    const combined = `${tipoEquipo || ''} ${categoriaEquipo || ''}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    if (
        /\b(carro\s+de\s+arrastre|remolque|semirremolque|cama\s+baja|lowboy|acoplado|estanque\s+(?:movil\s+)?remolcado|cisterna\s+remolcada|implemento\s+remolcado|dolly)\b/.test(
            combined
        )
    ) {
        return ARCHETYPE_DEFINITIONS.REMOLQUE_CARRO_ARRASTRE_IMPLEMENTO;
    }
    if (
        /\b(chancador|trituradora|harnero|zaranda|apilador\s+movil|lokotrack|mobirex|mobicone|mobiscreen|planta\s+(?:movil\s+)?de\s+(?:chancado|harneado|trituracion|seleccion))\b/.test(
            combined
        )
    ) {
        return ARCHETYPE_DEFINITIONS.PLANTA_MOVIL_CHANCADO_HARNERO;
    }
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

function stripTextAccents(input: string): string {
    return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function normalizeCanonicalEnergyEnumLabel(rawVal: string): string | null {
    const norm = stripTextAccents(rawVal);
    if (!norm) return null;
    if (/\b(remolcad[oa]|sin\s+propulsion\s+propia|arrastre\s+pasivo|auxiliar\s+12\s*v|auxiliar\s+24\s*v)\b/.test(norm)) {
        return 'Remolcado / Sin Propulsión Propia (Auxiliar 12V/24V/Manual)';
    }
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

export function normalizeCanonicalTransmissionSlotValue(rawVal: string): string | null {
    const clean = String(rawVal || '').replace(/\s+/g, ' ').trim();
    const norm = stripTextAccents(clean);
    if (!norm) return null;

    if (/\ballison\b/.test(norm)) {
        const modelMatch = clean.match(/\ballison\s*[a-z0-9 -]{0,24}/i);
        return modelMatch
            ? `Automática (${modelMatch[0].replace(/\s+/g, ' ').trim()})`.slice(0, 72)
            : 'Automática (Allison)';
    }
    if (/\b(m-?drive|i-?shift|opticruise|traxon|as[- ]?tronic|ultrashift|endurant|dt12)\b/.test(norm)) {
        const amtMatch = clean.match(
            /\b((?:mack\s+)?m-?drive(?:\s+hd|\s+tmd\w+)?|(?:volvo\s+)?i-?shift|(?:scania\s+)?opticruise|(?:zf\s+)?(?:traxon|as[- ]?tronic)|(?:eaton\s+)?(?:ultrashift|endurant)|detroit\s+dt12)\b/i
        );
        return amtMatch
            ? `Automatizada AMT (${amtMatch[1].replace(/\s+/g, ' ').trim()})`.slice(0, 72)
            : 'Automatizada (AMT)';
    }
    if (/\b(fuller|roadranger|rtlo-?\d{4,5})\b/.test(norm)) {
        const velMatch = clean.match(/\b(\d{1,2}\s*vel(?:ocidades)?|rtlo-?\d{4,5}[a-z]?)\b/i);
        return velMatch
            ? `Manual Eaton Fuller (${velMatch[1].replace(/\s+/g, ' ').trim()})`.slice(0, 72)
            : 'Manual Eaton Fuller';
    }
    if (/\bhidrostatic/.test(norm)) {
        const velMatch = clean.match(/\b\d\s*(?:vel(?:ocidades)?|marchas|rangos)\b/i);
        return velMatch ? `Hidrostática (${velMatch[0].trim()})` : 'Hidrostática';
    }
    if (/\b(powershift|power\s+shift|servotransmision|torqflow)\b/.test(norm)) {
        const fgMatch = clean.match(/\b\d+f\s*\/?\s*\d+r\b/i);
        return fgMatch ? `Powershift (${fgMatch[0].toUpperCase()})` : 'Powershift';
    }
    if (/\b(electrica\s+ac|ac\s+drive|traccion\s+electrica)\b/.test(norm)) {
        return 'Eléctrica AC';
    }
    if (/\b(cvt|e-cvt)\b/.test(norm)) {
        return 'CVT';
    }
    if (/\b(automatizada|\bamt\b)\b/.test(norm)) {
        const velMatch = clean.match(/\b\d{1,2}\s*(?:vel(?:ocidades)?|marchas)\b/i);
        return velMatch ? `Automatizada AMT (${velMatch[0].trim()})` : 'Automatizada (AMT)';
    }
    if (/\b(automatic[ao]|convertidor\s+de\s+par|\b\d{1,2}\s*at\b)\b/.test(norm)) {
        const velMatch = clean.match(/\b\d{1,2}\s*(?:vel(?:ocidades)?|marchas|at)\b/i);
        return velMatch ? `Automática (${velMatch[0].trim()})` : 'Automática (Convertidor)';
    }
    if (/\b(manual|mecanica|\b\d{1,2}\s*mt\b|sincronizada)\b/.test(norm)) {
        const velMatch = clean.match(/\b\d{1,2}\s*(?:vel(?:ocidades)?|marchas|mt)\b/i);
        return velMatch ? `Manual (${velMatch[0].trim()})` : 'Manual sincronizada';
    }
    return null;
}

export function normalizeCanonicalAxleSlotValue(rawVal: string): string | null {
    const norm = stripTextAccents(rawVal);
    if (!norm) return null;
    const m = norm.match(/\b(10x6|10x4|8x8|8x6|8x4|6x6|6x4|6x2|4x4|4x2|awd|fwd|rwd)\b/i);
    if (!m) return null;
    const tok = m[1].toLowerCase();
    if (tok === 'awd' || tok === 'fwd' || tok === 'rwd') return tok.toUpperCase();
    return tok;
}

/**
 * Limpia y valida un valor contra un eje dinámico por `TIPO` (`EquipmentTypeAxisSchemaItem` o `CanonicalSpecSlot` auto-descriptivo).
 * - Rechaza cualquier prosa publicitaria o años históricos de producción.
 * - Si `value_kind === 'CLOSED_ENUM'`, exige pertenencia a `allowed_enum_values` (o enum técnico corto sin verbos comerciales).
 * - Si `value_kind === 'PHYSICAL_MAGNITUDE'`, exige magnitud numérica con unidad de ingeniería SI.
 */
export function cleanDynamicAxisValue(
    rawVal: unknown,
    axisMeta?: {
        axis_key?: string;
        value_kind?: EquipmentAxisValueKind;
        allowed_enum_values?: string[];
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
    if (!valueOnly || valueOnly.length > 96) {
        return null;
    }

    if (axisMeta?.axis_key === 'fuente_energia' || (axisMeta?.value_kind === 'CLOSED_ENUM' && ENERGY_SOURCE_VALUE_REGEX.test(valueOnly))) {
        const canonEnergy = normalizeCanonicalEnergyEnumLabel(valueOnly);
        if (canonEnergy) return canonEnergy;
    }

    if (
        axisMeta?.axis_key === 'transmision_caja' ||
        axisMeta?.axis_key === 'tipo_transmision' ||
        axisMeta?.axis_key === 'caja_cambios'
    ) {
        const canonTx = normalizeCanonicalTransmissionSlotValue(valueOnly);
        if (canonTx) return canonTx;
    }

    if (axisMeta?.axis_key === 'traccion_ejes' || axisMeta?.axis_key === 'traccion') {
        const canonAxle = normalizeCanonicalAxleSlotValue(valueOnly);
        if (canonAxle) return canonAxle;
    }

    if (axisMeta?.value_kind === 'CLOSED_ENUM') {
        if (Array.isArray(axisMeta.allowed_enum_values) && axisMeta.allowed_enum_values.length > 0) {
            const normVal = stripTextAccents(valueOnly);
            const matchedEnum = axisMeta.allowed_enum_values.find(
                (opt) => stripTextAccents(opt) === normVal || normVal.includes(stripTextAccents(opt))
            );
            return matchedEnum || null;
        }
        return valueOnly.length <= 48 ? valueOnly : null;
    }

    if (!ANY_ENGINEERING_METRIC_REGEX.test(valueOnly)) {
        return null;
    }

    return valueOnly;
}

/**
 * Limpia y verifica un valor individual para un eje físico canónico:
 * - Rechaza cualquier frase con léxico publicitario/comercial o datos históricos accesorios.
 * - Rechaza valores vacíos o placeholders.
 * - Recorta etiquetas repetidas al inicio ("Potencia neta: 388 kW" -> "388 kW").
 */
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

    // Si viene con prefijo "Etiqueta: Valor", conservar únicamente el valor métrico limpio
    let valueOnly = str;
    const colonIdx = str.indexOf(':');
    if (colonIdx > 0 && colonIdx < 48) {
        valueOnly = str.slice(colonIdx + 1).trim();
    }

    valueOnly = valueOnly.replace(/\.+$/, '').trim();
    if (!valueOnly || valueOnly.length > 96) {
        return null;
    }

    if (axisDef?.axis_key === 'fuente_energia') {
        const canonEnergy = normalizeCanonicalEnergyEnumLabel(valueOnly);
        if (canonEnergy) return canonEnergy;
    }

    if (axisDef && !axisDef.validValuePattern.test(valueOnly)) {
        return null;
    }

    return valueOnly;
}

/**
 * Infiere únicamente el enum cinemático discreto verificable ("Levante vertical" | "Levante radial")
 * para Minicargadores cuando consta explícitamente en la denominación técnica OEM, sin arrastrar jamás prosa.
 */
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

/**
 * Extrae el mapa homólogo de valores verificados (`axis_key -> value_si | null`) para cualquier activo:
 * 1. Prioriza la plantilla auto-descriptiva propia del `TIPO` (`equipment_type_key` + `canonical_specs`)
 *    para soportar cualquier tipo de vehículo, maquinaria, compresor, perforadora o herramienta sin parámetros ajenos.
 * 2. Mantiene respaldo determinista de 14 arquetipos para documentos legacy previos en Firestore.
 */
export function extractHomologousAxisValues(record: {
    equipment_type_key?: string;
    archetype_id?: string;
    tipo_equipo?: string;
    categoria_equipo?: string;
    canonical_specs?: CanonicalSpecSlot[] | Record<string, any> | null;
    caracteristicas_principales?: string[];
}): { archetype: ArchetypeDefinition; slots: CanonicalSpecSlot[] } {
    const explicitArch =
        record.archetype_id && record.archetype_id in ARCHETYPE_DEFINITIONS
            ? ARCHETYPE_DEFINITIONS[record.archetype_id as MachineryArchetypeId]
            : null;
    const baseArchetype = explicitArch || resolveMachineryArchetype(record.tipo_equipo, record.categoria_equipo);

    // RUTA PRIMARIA: Esquema específico del `TIPO` de equipo (auto-descriptivo e ilimitado)
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
                ...(item.unit_si !== undefined ? { unit_si: item.unit_si } : {}),
                mandatory: isMandatory,
                ...(typeof item.is_differentiator === 'boolean' ? { is_differentiator: item.is_differentiator } : {}),
                ...(item.value_kind ? { value_kind: item.value_kind } : {}),
                ...(Array.isArray(item.allowed_enum_values) && item.allowed_enum_values.length > 0
                    ? { allowed_enum_values: item.allowed_enum_values }
                    : {}),
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

    // RUTA DE RESPALDO RETROCOMPATIBLE (Documentos legacy sin `equipment_type_key` ni slots auto-descriptivos)
    const archetype = baseArchetype;
    const byKey = new Map<string, { value_si: string | null; source_url?: string | null; verbatim_evidence?: string | null }>();

    if (Array.isArray(record.canonical_specs)) {
        for (const item of record.canonical_specs) {
            if (!item || typeof item.axis_key !== 'string') continue;
            const axisDef = archetype.axes.find((a) => a.axis_key === item.axis_key);
            const cleaned = axisDef
                ? cleanCanonicalAxisValue(item.value_si, axisDef)
                : cleanDynamicAxisValue(item.value_si, item);
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

    const legacyLines = Array.isArray(record.caracteristicas_principales)
        ? record.caracteristicas_principales.map((l) => String(l || '').trim()).filter(Boolean)
        : [];

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

    if (archetype.id === 'MINICARGADOR_SSL_CTL' && !byKey.has('cinematica_levante')) {
        const kin = inferDiscreteSkidSteerKinematics(record as Record<string, any>);
        if (kin) {
            byKey.set('cinematica_levante', { value_si: kin, source_url: null });
        }
    }

    const rawSlots: CanonicalSpecSlot[] = archetype.axes.map((axis) => {
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

    const slots = normalizeCanonicalSlotsByResolvedEnergy(rawSlots, {
        typeContextText: `${record.equipment_type_key || ''} ${record.tipo_equipo || ''} ${record.categoria_equipo || ''}`,
    });

    return { archetype, slots };
}

/**
 * Construye la línea descriptiva homóloga e invariante del equipo para `CATÁLOGO` y `FLOTA`:
 * - Siempre presenta los ejes obligatorios del `TIPO` en el MISMO orden fijo para permitir comparación 1 a 1.
 * - Cero truncamiento (`.slice` prohibido), cero prosa publicitaria y cero cifras inventadas.
 * - Si un eje obligatorio puntual no ha sido declarado/verificado, muestra `[No declarado en ficha]`.
 * - Si ningún eje del activo tiene dato verificado, devuelve `[Información técnica no declarada en ficha]`.
 */
export function buildHomologousEquipmentDescription(record: {
    equipment_type_key?: string;
    archetype_id?: string;
    tipo_equipo?: string;
    categoria_equipo?: string;
    canonical_specs?: CanonicalSpecSlot[] | Record<string, any> | null;
    caracteristicas_principales?: string[];
}): string {
    const { slots } = extractHomologousAxisValues(record);

    const hasAnyVerifiedValue = slots.some((s) => Boolean(s.value_si));
    if (!hasAnyVerifiedValue) {
        return MISSING_FULL_TECH_SPEC;
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

/**
 * Serializa los `CanonicalSpecSlot[]` verificados hacia `caracteristicas_principales: string[]`
 * resolviendo dinámicamente la semántica energética real del activo (cero etiquetas híbridas
 * `Capacidad estanque / batería` en equipos diésel o eléctricos).
 */
export function serializeCanonicalSlotsToSpecsArray(
    slots: CanonicalSpecSlot[],
    context?: { typeContextText?: string | null; primaryEnergy?: string | null }
): string[] {
    const normalizedSlots = normalizeCanonicalSlotsByResolvedEnergy(slots, context);
    const valid = normalizedSlots
        .filter((s) => Boolean(s.value_si))
        .map((s) => `${s.label_es}: ${s.value_si}`);
    return valid.length > 0 ? valid : [MISSING_FULL_TECH_SPEC];
}

/**
 * Auditoría física cruzada sobre un conjunto de `CanonicalSpecSlot` para detectar contradicciones dimensionales
 * (ej. ROC mayor al 75% del peso operativo en un minicargador, o alturas imposibles).
 */
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
        // Distinguir separador de miles (ej. "3.166 kg" o "70.170 kg") vs decimal ("34,4 m³" o "54.6 kW")
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

export type CanonicalResolvedEnergyKind =
    | 'THERMAL_FUEL'
    | 'BATTERY_BEV'
    | 'HYBRID'
    | 'GRID_AC'
    | 'PNEUMATIC_AIR'
    | 'HYDRAULIC_AUX'
    | 'TOWED_PASSIVE'
    | 'MANUAL_MECHANICAL';

export interface ResolvedEnergyAxisSemantics {
    energyKind: CanonicalResolvedEnergyKind;
    includeEnergySourceAxis: boolean;
    includeConsumptionAxis: boolean;
    includeCapacityAxis: boolean;
    consumptionLabelEs: string;
    consumptionUnitSi: string;
    consumptionKeywords: string[];
    capacityLabelEs: string | null;
    capacityUnitSi: string | null;
    capacityKeywords: string[];
}

export function classifyCanonicalEnergyKind(params?: {
    primaryEnergy?: string | null;
    energyValueText?: string | null;
    typeContextText?: string | null;
}): CanonicalResolvedEnergyKind {
    const valNorm = stripTextAccents(params?.energyValueText || '');
    const primaryNorm = String(params?.primaryEnergy || '').trim().toUpperCase();
    const ctxNorm = stripTextAccents(params?.typeContextText || '');

    // 1. Prioridad máxima: valor explícito de `fuente_energia` en el activo
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

    // 2. Rasgo físico ontológico (`AssetPhysicalTraits.primary_energy` o `energy_consumption_profile.energy_source`)
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

    // 3. Inferencia determinista por contexto de `TIPO`
    if (
        /\b(torquimetro\s+manual|tecle\s+manual|polipasto\s+manual|gata\s+mecanica|herramienta\s+manual)\b/.test(
            ctxNorm
        )
    ) {
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
    if (
        /\b(llave\s+(?:de\s+)?torque\s+hidraulic|700\s*bar|cilindro\s+hidraulico\s+portatil|tensor\s+hidraulico)\b/.test(
            ctxNorm
        )
    ) {
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

export function resolveEnergyAxisSemantics(params?: {
    primaryEnergy?: string | null;
    energyValueText?: string | null;
    typeContextText?: string | null;
}): ResolvedEnergyAxisSemantics {
    const energyKind = classifyCanonicalEnergyKind(params);
    const ctxNorm = stripTextAccents(params?.typeContextText || '');
    const isRoadOrUtilityVehicle =
        /\b(camion\s+tolva|tractocamion|camion\s+aljibe|camion\s+pluma|camion\s+lubricador|camion\s+mixer|camioneta|pick\s*up|automovil|suv|furgon|van|bus|minibus|vehiculo|motocicleta|volquete)\b/.test(
            ctxNorm
        ) && !/\b(caex|camion\s+de\s+extraccion|ultra\s*class)\b/.test(ctxNorm);
    const isDroneOrCyclicBattery = /\b(dron|rpas|uav|herramienta\s+inalambrica)\b/.test(ctxNorm);

    switch (energyKind) {
        case 'MANUAL_MECHANICAL':
            return {
                energyKind,
                includeEnergySourceAxis: true,
                includeConsumptionAxis: false,
                includeCapacityAxis: false,
                consumptionLabelEs: 'Consumo energético',
                consumptionUnitSi: '0 W',
                consumptionKeywords: [],
                capacityLabelEs: null,
                capacityUnitSi: null,
                capacityKeywords: [],
            };
        case 'TOWED_PASSIVE':
            return {
                energyKind,
                includeEnergySourceAxis: true,
                includeConsumptionAxis: false,
                includeCapacityAxis: false,
                consumptionLabelEs: 'Demanda auxiliar remolque',
                consumptionUnitSi: '12V / 24V',
                consumptionKeywords: ['sistema eléctrico 12V', '24V', 'remolcado'],
                capacityLabelEs: null,
                capacityUnitSi: null,
                capacityKeywords: [],
            };
        case 'GRID_AC':
            return {
                energyKind,
                includeEnergySourceAxis: true,
                includeConsumptionAxis: true,
                includeCapacityAxis: false,
                consumptionLabelEs: 'Potencia eléctrica absorbida',
                consumptionUnitSi: 'kW · kWh/h',
                consumptionKeywords: ['potencia absorbida', 'consumo eléctrico', 'corriente nominal', 'kW', 'kVA', 'kWh/h'],
                capacityLabelEs: null,
                capacityUnitSi: null,
                capacityKeywords: [],
            };
        case 'PNEUMATIC_AIR':
            return {
                energyKind,
                includeEnergySourceAxis: true,
                includeConsumptionAxis: true,
                includeCapacityAxis: false,
                consumptionLabelEs: 'Consumo de aire requerido',
                consumptionUnitSi: 'L/s (m³/min @ bar)',
                consumptionKeywords: ['consumo de aire', 'air consumption', 'L/s', 'm³/min', 'cfm', 'bar'],
                capacityLabelEs: null,
                capacityUnitSi: null,
                capacityKeywords: [],
            };
        case 'HYDRAULIC_AUX':
            return {
                energyKind,
                includeEnergySourceAxis: true,
                includeConsumptionAxis: true,
                includeCapacityAxis: false,
                consumptionLabelEs: 'Caudal / presión hidráulica req.',
                consumptionUnitSi: 'L/min @ bar',
                consumptionKeywords: ['caudal requerido', 'presión máxima de trabajo', '700 bar', 'L/min', 'bar'],
                capacityLabelEs: null,
                capacityUnitSi: null,
                capacityKeywords: [],
            };
        case 'BATTERY_BEV':
            return {
                energyKind,
                includeEnergySourceAxis: true,
                includeConsumptionAxis: true,
                includeCapacityAxis: true,
                consumptionLabelEs: isRoadOrUtilityVehicle
                    ? 'Consumo eléctrico nominal'
                    : isDroneOrCyclicBattery
                    ? 'Autonomía por carga'
                    : 'Consumo eléctrico horario',
                consumptionUnitSi: isRoadOrUtilityVehicle
                    ? 'kWh/100 km'
                    : isDroneOrCyclicBattery
                    ? 'min · Wh'
                    : 'kWh/h',
                consumptionKeywords: isRoadOrUtilityVehicle
                    ? ['consumo eléctrico', 'kWh/100 km', 'autonomía WLTP', 'autonomía km']
                    : isDroneOrCyclicBattery
                    ? ['tiempo máximo de vuelo', 'max flight time', 'autonomía', 'min', 'Wh']
                    : ['consumo eléctrico', 'kWh/h', 'autonomía operativa'],
                capacityLabelEs: 'Capacidad banco baterías',
                capacityUnitSi: 'kWh · Wh',
                capacityKeywords: ['capacidad batería', 'battery capacity', 'banco de baterías', 'kWh', 'Wh', 'Ah'],
            };
        case 'HYBRID':
            return {
                energyKind,
                includeEnergySourceAxis: true,
                includeConsumptionAxis: true,
                includeCapacityAxis: true,
                consumptionLabelEs: isRoadOrUtilityVehicle ? 'Rendimiento combinado' : 'Consumo horario combinado',
                consumptionUnitSi: isRoadOrUtilityVehicle ? 'km/L · kWh/100 km' : 'L/h · kWh/h',
                consumptionKeywords: ['consumo combinado', 'rendimiento combustible', 'L/h', 'km/L', 'kWh'],
                capacityLabelEs: 'Capacidad estanque + batería HV',
                capacityUnitSi: 'L + kWh',
                capacityKeywords: ['capacidad estanque', 'fuel tank capacity', 'capacidad batería', 'kWh', 'litros'],
            };
        case 'THERMAL_FUEL':
        default:
            return {
                energyKind: 'THERMAL_FUEL',
                includeEnergySourceAxis: true,
                includeConsumptionAxis: true,
                includeCapacityAxis: true,
                consumptionLabelEs: isRoadOrUtilityVehicle
                    ? 'Rendimiento / consumo combustible'
                    : 'Consumo horario combustible',
                consumptionUnitSi: isRoadOrUtilityVehicle ? 'km/L (L/100 km) · L/h' : 'L/h · g/kWh',
                consumptionKeywords: isRoadOrUtilityVehicle
                    ? [
                          'consumo de combustible',
                          'rendimiento de combustible',
                          'fuel consumption',
                          'km/L',
                          'L/100 km',
                          'L/h',
                          'g/kWh',
                      ]
                    : [
                          'consumo de combustible',
                          'fuel consumption',
                          'consumo horario',
                          'L/h',
                          'gal/h',
                          'consumo específico',
                          'BSFC',
                          'g/kWh',
                      ],
                capacityLabelEs: 'Capacidad estanque combustible',
                capacityUnitSi: 'L',
                capacityKeywords: [
                    'capacidad tanque de combustible',
                    'capacidad estanque',
                    'fuel tank capacity',
                    'estanque diésel',
                    'fuel capacity',
                    'litros',
                ],
            };
    }
}

const HYBRID_LEGACY_CAPACITY_LABEL_REGEX =
    /\b(estanque\s*\/\s*bater[ií]a|estanque\s*\/\s*carga|tanque\s*\/\s*bater[ií]a|combustible\s*\/\s*bater[ií]a)\b/i;
const HYBRID_LEGACY_CONSUMPTION_LABEL_REGEX =
    /^(consumo\s+nominal|consumo\s*\/\s*demanda.*|consumo\s+auxiliar\s*\/\s*tracci[oó]n)$/i;

/**
 * Normaliza determinísticamente los `CanonicalSpecSlot[]` de un activo según su vector energético real:
 * 1. Elimina ejes de estanque/batería o consumo cuando el equipo no posee físicamente ese subsistema
 *    (ej. equipos eléctricos conectados a red AC, neumáticos, hidráulicos auxiliares o manuales).
 * 2. Sustituye cualquier etiqueta híbrida heredada (`Capacidad estanque / batería`) por la denominación
 *    física exacta (`Capacidad estanque combustible` en Diésel/Gasolina/GLP, `Capacidad banco baterías` en BEV).
 */
export function normalizeCanonicalSlotsByResolvedEnergy(
    slots: CanonicalSpecSlot[] | null | undefined,
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
            (ENERGY_SOURCE_AXIS_KEY_ALIASES.has(s.axis_key) ||
                /\bfuente\s+(?:de\s+)?energ[ií]a\b/i.test(s.label_es || '')) &&
            s.value_si &&
            !s.value_si.startsWith('[')
    );

    const semantics = resolveEnergyAxisSemantics({
        energyValueText: context?.energyValueText || sourceSlot?.value_si || null,
        primaryEnergy: context?.primaryEnergy || null,
        typeContextText: context?.typeContextText || null,
    });

    const out: CanonicalSpecSlot[] = [];
    for (const slot of slots) {
        if (!slot) continue;
        const isConsumption =
            CONSUMPTION_AXIS_KEY_ALIASES.has(slot.axis_key) ||
            HYBRID_LEGACY_CONSUMPTION_LABEL_REGEX.test((slot.label_es || '').trim());
        const isCapacity =
            ENERGY_CAPACITY_AXIS_KEY_ALIASES.has(slot.axis_key) ||
            HYBRID_LEGACY_CAPACITY_LABEL_REGEX.test(slot.label_es || '');

        if (isConsumption) {
            if (!semantics.includeConsumptionAxis) continue;
            const shouldRewriteConsumptionLabel =
                slot.axis_key === 'consumo_energetico_nominal' ||
                HYBRID_LEGACY_CONSUMPTION_LABEL_REGEX.test((slot.label_es || '').trim()) ||
                (semantics.energyKind === 'THERMAL_FUEL' && /\bel[eé]ctric/i.test(slot.label_es || '')) ||
                (semantics.energyKind === 'BATTERY_BEV' && /\bcombustible\b/i.test(slot.label_es || ''));
            out.push({
                ...slot,
                label_es: shouldRewriteConsumptionLabel ? semantics.consumptionLabelEs : slot.label_es,
                unit_si: shouldRewriteConsumptionLabel ? semantics.consumptionUnitSi : slot.unit_si,
            });
            continue;
        }

        if (isCapacity) {
            if (!semantics.includeCapacityAxis || !semantics.capacityLabelEs) continue;
            const shouldRewriteCapacityLabel =
                slot.axis_key === 'capacidad_energetica_autonomia' ||
                HYBRID_LEGACY_CAPACITY_LABEL_REGEX.test(slot.label_es || '') ||
                (semantics.energyKind === 'THERMAL_FUEL' && /\bbater[ií]a\b/i.test(slot.label_es || '')) ||
                (semantics.energyKind === 'BATTERY_BEV' && /\b(estanque|tanque|combustible)\b/i.test(slot.label_es || ''));
            out.push({
                ...slot,
                label_es: shouldRewriteCapacityLabel ? semantics.capacityLabelEs : slot.label_es,
                unit_si:
                    shouldRewriteCapacityLabel && semantics.capacityUnitSi
                        ? semantics.capacityUnitSi
                        : slot.unit_si,
            });
            continue;
        }

        out.push(slot);
    }

    return out;
}

/**
 * Normaliza líneas planas de `caracteristicas_principales` ya persistidas en Firestore,
 * corrigiendo al vuelo etiquetas híbridas (`Capacidad estanque / batería: 122 L` -> `Capacidad estanque combustible: 122 L`)
 * y purgando líneas de estanque/batería en activos conectados a red, neumáticos o manuales.
 */
export function normalizeLegacySpecLinesByEnergy(
    rawLines: unknown,
    context?: {
        energyValueText?: string | null;
        primaryEnergy?: string | null;
        typeContextText?: string | null;
    }
): string[] {
    if (!Array.isArray(rawLines)) return [];
    const lines = rawLines.map((l) => String(l || '').trim()).filter(Boolean);
    if (lines.length === 0) return [];

    let detectedEnergyFromLines = context?.energyValueText || null;
    if (!detectedEnergyFromLines) {
        for (const line of lines) {
            const m = line.match(/^fuente\s+(?:de\s+)?energ[ií]a\s*:\s*(.+)$/i);
            if (m && m[1]) {
                detectedEnergyFromLines = m[1].trim();
                break;
            }
        }
    }

    const semantics = resolveEnergyAxisSemantics({
        energyValueText: detectedEnergyFromLines,
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
            HYBRID_LEGACY_CAPACITY_LABEL_REGEX.test(rawLabel) ||
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

        if (HYBRID_LEGACY_CONSUMPTION_LABEL_REGEX.test(rawLabel)) {
            if (!semantics.includeConsumptionAxis) continue;
            out.push(`${semantics.consumptionLabelEs}: ${rawVal}`);
            continue;
        }

        out.push(line);
    }

    return out;
}

/**
 * Construye los ejes canónicos de Matriz Energética, Consumo y Capacidad/Autonomía
 * adaptados estrictamente al vector energético real del `TIPO` (omitiendo ejes inexistentes
 * como estanque/batería en activos conectados a red AC, neumáticos, hidráulicos o manuales).
 */
export function buildUniversalEnergySpecAxesForType(
    typeContextText: string,
    primaryEnergyHint?: string | null
): EquipmentTypeAxisSchemaItem[] {
    const semantics = resolveEnergyAxisSemantics({
        primaryEnergy: primaryEnergyHint || null,
        typeContextText,
    });

    const axes: EquipmentTypeAxisSchemaItem[] = [];

    if (semantics.includeEnergySourceAxis) {
        axes.push({
            axis_key: 'fuente_energia',
            label_es: 'Fuente energía',
            unit_si:
                semantics.energyKind === 'TOWED_PASSIVE'
                    ? 'Remolcado / Auxiliar 12V-24V'
                    : semantics.energyKind === 'MANUAL_MECHANICAL'
                    ? 'Manual / Mecánico'
                    : 'Diésel | Gasolina | Eléctrico | Híbrido | GLP/GNV | Neumático',
            value_kind: 'CLOSED_ENUM',
            allowed_enum_values: UNIVERSAL_ENERGY_SOURCE_ENUM_VALUES,
            search_keywords: [
                'tipo de combustible',
                'fuente de energía',
                'fuel type',
                'diésel',
                'gasolina',
                'eléctrico',
                'batería',
                'híbrido',
                'GLP',
                'aire comprimido',
            ],
            mandatory: true,
            is_differentiator: false,
        });
    }

    if (semantics.includeConsumptionAxis) {
        axes.push({
            axis_key: 'consumo_energetico_nominal',
            label_es: semantics.consumptionLabelEs,
            unit_si: semantics.consumptionUnitSi,
            value_kind: 'PHYSICAL_MAGNITUDE',
            search_keywords: semantics.consumptionKeywords,
            mandatory: true,
            is_differentiator: true,
        });
    }

    if (semantics.includeCapacityAxis && semantics.capacityLabelEs && semantics.capacityUnitSi) {
        axes.push({
            axis_key: 'capacidad_energetica_autonomia',
            label_es: semantics.capacityLabelEs,
            unit_si: semantics.capacityUnitSi,
            value_kind: 'PHYSICAL_MAGNITUDE',
            search_keywords: semantics.capacityKeywords,
            mandatory: true,
            is_differentiator: false,
        });
    }

    return axes;
}

const CONSUMPTION_AXIS_KEY_ALIASES = new Set([
    'consumo_energetico_nominal',
    'consumo_combustible',
    'consumo_aire',
    'consumo_nominal',
    'consumo_horario',
    'rendimiento_combustible',
]);

const ENERGY_SOURCE_AXIS_KEY_ALIASES = new Set([
    'fuente_energia',
    'tipo_combustible',
    'tipo_energia',
    'energia_motriz',
]);

const ENERGY_CAPACITY_AXIS_KEY_ALIASES = new Set([
    'capacidad_energetica_autonomia',
    'capacidad_estanque',
    'capacidad_combustible',
    'capacidad_bateria',
    'estanque_combustible',
]);

/**
 * Inyecta y sanea de forma idempotente los ejes universales de Energía, Consumo y Capacidad/Autonomía
 * en cualquier `spec_schema` de `GlobalEquipmentTypeDoc`:
 * - Reemplaza etiquetas híbridas heredadas (`Capacidad estanque / batería`, `Consumo nominal`) por etiquetas exactas.
 * - Elimina ejes de estanque/batería o consumo cuando no corresponden a la física energética del `TIPO`.
 */
export function ensureUniversalEnergyAxesInSpecSchema(
    existingSchema: EquipmentTypeAxisSchemaItem[],
    typeContextText: string,
    primaryEnergyHint?: string | null
): EquipmentTypeAxisSchemaItem[] {
    const semantics = resolveEnergyAxisSemantics({
        primaryEnergy: primaryEnergyHint || null,
        typeContextText,
    });
    const universalAxes = buildUniversalEnergySpecAxesForType(typeContextText, primaryEnergyHint);
    const universalByKey = new Map(universalAxes.map((ax) => [ax.axis_key, ax]));

    // 1. Limpiar y actualizar ejes existentes en sitio
    const cleanedBase: EquipmentTypeAxisSchemaItem[] = [];
    for (const ax of Array.isArray(existingSchema) ? existingSchema : []) {
        if (!ax) continue;
        const isConsumption =
            CONSUMPTION_AXIS_KEY_ALIASES.has(ax.axis_key) ||
            HYBRID_LEGACY_CONSUMPTION_LABEL_REGEX.test((ax.label_es || '').trim());
        const isCapacity =
            ENERGY_CAPACITY_AXIS_KEY_ALIASES.has(ax.axis_key) ||
            HYBRID_LEGACY_CAPACITY_LABEL_REGEX.test(ax.label_es || '');

        if (isConsumption) {
            if (!semantics.includeConsumptionAxis) continue;
            const targetConsumption = universalByKey.get('consumo_energetico_nominal');
            if (
                targetConsumption &&
                (ax.axis_key === 'consumo_energetico_nominal' ||
                    HYBRID_LEGACY_CONSUMPTION_LABEL_REGEX.test((ax.label_es || '').trim()))
            ) {
                cleanedBase.push({
                    ...ax,
                    label_es: targetConsumption.label_es,
                    unit_si: targetConsumption.unit_si,
                    search_keywords: targetConsumption.search_keywords,
                });
            } else {
                cleanedBase.push({ ...ax });
            }
            continue;
        }

        if (isCapacity) {
            if (!semantics.includeCapacityAxis) continue;
            const targetCapacity = universalByKey.get('capacidad_energetica_autonomia');
            if (
                targetCapacity &&
                (ax.axis_key === 'capacidad_energetica_autonomia' ||
                    HYBRID_LEGACY_CAPACITY_LABEL_REGEX.test(ax.label_es || '') ||
                    (semantics.energyKind === 'THERMAL_FUEL' && /\bbater[ií]a\b/i.test(ax.label_es || '')) ||
                    (semantics.energyKind === 'BATTERY_BEV' && /\b(estanque|tanque|combustible)\b/i.test(ax.label_es || '')))
            ) {
                cleanedBase.push({
                    ...ax,
                    label_es: targetCapacity.label_es,
                    unit_si: targetCapacity.unit_si,
                    search_keywords: targetCapacity.search_keywords,
                });
            } else {
                cleanedBase.push({ ...ax });
            }
            continue;
        }

        cleanedBase.push({ ...ax });
    }

    // 2. Insertar únicamente los ejes energéticos requeridos que aún falten
    const hasEnergySource = cleanedBase.some(
        (ax) =>
            ENERGY_SOURCE_AXIS_KEY_ALIASES.has(ax.axis_key) ||
            /\b(fuente\s+.*energ|tipo\s+.*combustible|combustible)\b/i.test(ax.label_es)
    );
    const hasConsumption = cleanedBase.some(
        (ax) =>
            CONSUMPTION_AXIS_KEY_ALIASES.has(ax.axis_key) ||
            /\b(consumo|rendimiento\s+.*combustible|potencia\s+el[eé]ctrica\s+absorbida|autonom[ií]a\s+por\s+carga|caudal\s*\/\s*presi[oó]n|bsfc)\b/i.test(
                ax.label_es
            )
    );
    const hasCapacity = cleanedBase.some(
        (ax) =>
            ENERGY_CAPACITY_AXIS_KEY_ALIASES.has(ax.axis_key) ||
            /\b(estanque|tanque\s+.*combustible|banco\s+bater[ií]as|bater[ií]a)\b/i.test(ax.label_es)
    );

    const energyAxis = universalByKey.get('fuente_energia');
    const consumptionAxis = universalByKey.get('consumo_energetico_nominal');
    const capacityAxis = universalByKey.get('capacidad_energetica_autonomia');

    if (semantics.includeEnergySourceAxis && !hasEnergySource && energyAxis) {
        cleanedBase.push(energyAxis);
    }
    if (semantics.includeConsumptionAxis && !hasConsumption && consumptionAxis) {
        cleanedBase.push(consumptionAxis);
    }
    if (semantics.includeCapacityAxis && !hasCapacity && capacityAxis) {
        cleanedBase.push(capacityAxis);
    }

    return cleanedBase.slice(0, 14);
}

/**
 * Ontología v8.0: Inyecta determinísticamente los ejes diferenciadores universales de tren motriz,
 * configuración de ejes/rodaje y montaje según los rasgos físicos (`AssetPhysicalTraits`) del equipo,
 * garantizando que variantes críticas (ej. 8x4 vs 6x4, Automática Allison vs mDRIVE vs Manual Fuller,
 * Powershift vs Hidrostática, Orugas LGP vs Estándar) se capturen siempre desde el registro inicial.
 */
export function ensureUniversalDifferentiatorAxesInSpecSchema(
    existingSchema: EquipmentTypeAxisSchemaItem[],
    physicalTraits: {
        mobility?: string;
        functional_domain?: string;
        duty_travel_regime?: string;
    } | null | undefined,
    typeContextText: string
): EquipmentTypeAxisSchemaItem[] {
    const base = Array.isArray(existingSchema) ? existingSchema.map((ax) => ({ ...ax })) : [];
    const normCtx = stripTextAccents(typeContextText || '');
    const mobility = physicalTraits?.mobility || '';
    const domain = physicalTraits?.functional_domain || '';

    const isSelfPropelledWheeled = mobility === 'SELF_PROPELLED_WHEELED';
    const isSelfPropelledTracked = mobility === 'SELF_PROPELLED_TRACKED';
    const isTruckOrRoadVehicle =
        /\b(camion|tractocamion|volquete|aljibe|mixer|betonera|pluma|camioneta|pick[- ]?up|suv|furgon|van|bus|minibus)\b/.test(
            normCtx
        ) ||
        (isSelfPropelledWheeled &&
            (domain === 'HAULAGE_AND_TRANSPORT' || domain === 'VOCATIONAL_SERVICE_SUPPORT'));

    // 1. Promover y normalizar eje de tracción/configuración de ejes en vehículos sobre neumáticos
    if (isTruckOrRoadVehicle) {
        const isLightVehicle = /\b(camioneta|pick[- ]?up|suv|automovil|sedan|hatchback|furgon|van)\b/.test(normCtx);
        const existingAxleIdx = base.findIndex(
            (ax) =>
                ax.axis_key === 'traccion_ejes' ||
                ax.axis_key === 'traccion' ||
                /\b(configuracion\s+ejes|traccion)\b/i.test(stripTextAccents(ax.label_es))
        );
        const heavyEnums = ['4x2', '4x4', '6x2', '6x4', '6x6', '8x4', '8x6', '8x8'];
        const lightEnums = ['4x2', '4x4', 'AWD', 'FWD', 'RWD'];
        if (existingAxleIdx >= 0) {
            base[existingAxleIdx] = {
                ...base[existingAxleIdx],
                mandatory: true,
                is_differentiator: true,
                allowed_enum_values: isLightVehicle ? lightEnums : heavyEnums,
                unit_si: isLightVehicle ? lightEnums.join(' | ') : '4x2 | 6x4 | 8x4 | 6x6 | 8x8',
            };
        } else {
            base.push({
                axis_key: 'traccion_ejes',
                label_es: isLightVehicle ? 'Tracción' : 'Configuración ejes',
                unit_si: isLightVehicle ? lightEnums.join(' | ') : '4x2 | 6x4 | 8x4 | 6x6 | 8x8',
                value_kind: 'CLOSED_ENUM',
                allowed_enum_values: isLightVehicle ? lightEnums : heavyEnums,
                search_keywords: isLightVehicle
                    ? ['tracción', 'drive type', '4x4', '4x2', 'AWD']
                    : ['configuración de ejes', 'axle configuration', '4x2', '6x2', '6x4', '6x6', '8x4', '8x6', '8x8'],
                mandatory: true,
                is_differentiator: true,
            });
        }
    }

    // 2. Eje universal de Transmisión / Caja en maquinaria y vehículos autopropulsados con tren motriz
    const isExcludedFromGearbox =
        /\b(dron|rpas|uav|torre\s+de\s+iluminacion|soldadora|compresor|generador|grupo\s+electrogeno|motobomba|bomba\s+centrifuga|martillo|perforadora\s+manual|herramienta|carro\s+de\s+arrastre|remolque|semirremolque)\b/.test(
            normCtx
        );

    if ((isSelfPropelledWheeled || isSelfPropelledTracked) && !isExcludedFromGearbox) {
        const hasTransmissionAxis = base.some(
            (ax) =>
                ax.axis_key === 'transmision_caja' ||
                ax.axis_key === 'tipo_transmision' ||
                ax.axis_key === 'caja_cambios' ||
                /\b(transmision|caja\s+de\s+cambios)\b/i.test(stripTextAccents(ax.label_es))
        );
        if (!hasTransmissionAxis) {
            const txAllowed = [
                'Automática (Convertidor)',
                'Automatizada (AMT)',
                'Manual Eaton Fuller',
                'Manual sincronizada',
                'Powershift',
                'Hidrostática',
                'Eléctrica AC',
                'CVT',
            ];
            base.push({
                axis_key: 'transmision_caja',
                label_es: 'Transmisión / Caja',
                unit_si: 'Automática | Automatizada AMT | Manual Fuller | Manual | Powershift | Hidrostática',
                value_kind: 'CLOSED_ENUM',
                allowed_enum_values: txAllowed,
                search_keywords: [
                    'transmisión',
                    'caja de cambios',
                    'transmission',
                    'gearbox',
                    'Allison',
                    'mDRIVE',
                    'I-Shift',
                    'Opticruise',
                    'Eaton Fuller',
                    'Powershift',
                    'hidrostática',
                    'automática',
                    'manual',
                ],
                mandatory: true,
                is_differentiator: true,
            });
        }
    }

    // 3. Eje de configuración de tren de rodaje en equipos sobre orugas si no existe
    if (isSelfPropelledTracked && !/\b(chancador|harnero|planta)\b/.test(normCtx)) {
        const hasUndercarriage = base.some(
            (ax) =>
                ax.axis_key === 'configuracion_rodaje' ||
                /\b(tren\s+de\s+rodaje|oruga|zapatas|undercarriage)\b/i.test(stripTextAccents(ax.label_es))
        );
        if (!hasUndercarriage && base.length < 13) {
            base.push({
                axis_key: 'configuracion_rodaje',
                label_es: 'Tren de rodaje',
                unit_si: 'Oruga acero estándar | LC (Tren largo) | LGP (Baja presión) | Oruga goma',
                value_kind: 'CLOSED_ENUM',
                allowed_enum_values: [
                    'Oruga acero estándar',
                    'LC (Tren largo)',
                    'LGP (Baja presión)',
                    'High-Drive',
                    'Oruga goma',
                ],
                search_keywords: ['undercarriage', 'tren de rodaje', 'LC', 'LGP', 'rubber track', 'oruga'],
                mandatory: false,
                is_differentiator: true,
            });
        }
    }

    return base.slice(0, 14);
}

/**
 * Deriva determinísticamente el perfil estructurado `energy_consumption_profile` (para gestión de costos OPEX/TCO)
 * a partir de los `canonical_specs`, `caracteristicas_principales` y contenido verificado del Pilar 01 (`ficha_tecnica`).
 */
export function deriveEnergyConsumptionProfile(params: {
    tipo_equipo?: string | null;
    categoria_equipo?: string | null;
    canonical_specs?: CanonicalSpecSlot[] | null;
    caracteristicas_principales?: string[] | null;
    fichaTecnicaMarkdown?: string | null;
    official_url?: string | null;
    existingProfile?: Record<string, any> | null;
}): {
    energy_source:
    | 'DIESEL'
    | 'GASOLINA'
    | 'ELECTRICO_RED_AC'
    | 'ELECTRICO_BATERIA_BEV'
    | 'HIBRIDO_DIESEL_ELECTRICO'
    | 'HIBRIDO_GASOLINA_ELECTRICO'
    | 'DUAL_FUEL_DIESEL_GAS'
    | 'GLP_GNV'
    | 'NEUMATICO_AIRE_COMPRIMIDO'
    | 'HIDRAULICO_AUXILIAR'
    | 'REMOLCADO_SIN_PROPULSION_PROPIA'
    | 'MANUAL_MECANICO'
    | 'NO_DECLARADO';
    energy_spec_label: string | null;
    cost_driver_unit:
        | 'L/h'
        | 'km/L'
        | 'L/100km'
        | 'kWh/h'
        | 'kWh/100km'
        | 'kWh/ciclo'
        | 'L/s'
        | 'L/min'
        | 'bar (700 bar Hidr.)'
        | '0 L/h (Remolcado)'
        | '0 L/h (Manual)';
    hourly_consumption_by_load: {
        idle_or_pto: string | null;
        low_load_25_35pct: string | null;
        medium_load_50_65pct: string | null;
        high_load_80_100pct: string | null;
    };
    road_haul_efficiency: {
        km_per_liter: string | null;
        liters_per_100km: string | null;
        kwh_per_100km: string | null;
        highway_km_per_liter: string | null;
        highway_liters_per_100km: string | null;
        offroad_km_per_liter: string | null;
        offroad_liters_per_100km: string | null;
        estimated_range_km: string | null;
    };
    specific_consumption_bsfc_gkwh: string | null;
    pneumatic_or_hydraulic_flow: string | null;
    def_adblue_consumption: {
        requires_def: boolean;
        consumption_pct_of_fuel: string | null;
        tank_capacity_liters: string | null;
    };
    storage_and_autonomy: {
        tank_or_battery_capacity: string | null;
        estimated_autonomy: string | null;
    };
    source_url: string | null;
    updated_at: string;
} {
    const slots = Array.isArray(params.canonical_specs) ? params.canonical_specs : [];
    const prev = params.existingProfile && typeof params.existingProfile === 'object' ? params.existingProfile : {};
    const findSlot = (keys: string[]) =>
        slots.find((s) => s && keys.includes(s.axis_key) && s.value_si && !s.value_si.startsWith('[')) || null;

    const sourceSlot = findSlot(['fuente_energia', 'tipo_combustible', 'tipo_energia']);
    const consumptionSlot = findSlot([
        'consumo_energetico_nominal',
        'consumo_combustible',
        'consumo_aire',
        'consumo_nominal',
        'caudal_bomba_o_servicio_aux',
    ]);
    const capacitySlot = findSlot([
        'capacidad_energetica_autonomia',
        'capacidad_estanque',
        'capacidad_combustible',
        'capacidad_bateria',
        'capacidad_carga_o_volumen',
    ]);

    const corpusText = [
        params.fichaTecnicaMarkdown || '',
        sourceSlot?.value_si || '',
        consumptionSlot?.value_si || '',
        capacitySlot?.value_si || '',
        ...(Array.isArray(params.caracteristicas_principales) ? params.caracteristicas_principales : []),
        params.tipo_equipo || '',
    ].join('\n');

    const normCorpus = stripTextAccents(corpusText);
    const normSourceSlot = stripTextAccents(sourceSlot?.value_si || '');
    const normTypeAndCategory = stripTextAccents(`${params.tipo_equipo || ''} ${params.categoria_equipo || ''}`);

    const isTowedNonSelfPropelled =
        /\b(carro\s+de\s+arrastre|remolque|semirremolque|cama\s+baja|lowboy|acoplado|estanque\s+(?:movil\s+)?remolcado|cisterna\s+remolcada|implemento\s+remolcado|dolly|sin\s+propulsion\s+propia)\b/.test(
            `${normTypeAndCategory} ${normSourceSlot}`
        ) && !/\b(autopropulsad|motor\s+diesel|tractocamion)\b/.test(normTypeAndCategory);

    let energySource: ReturnType<typeof deriveEnergyConsumptionProfile>['energy_source'] =
        prev.energy_source && prev.energy_source !== 'NO_DECLARADO' ? prev.energy_source : 'NO_DECLARADO';

    const targetDetect = normSourceSlot || normCorpus;
    const isHighPressure700BarTool =
        /\b(llave\s+(?:de\s+)?torque\s+hidraulic|700\s*bar|10[.,]?000\s*psi|cilindro\s+hidraulico\s+portatil|tensor\s+hidraulico)\b/.test(
            `${normTypeAndCategory} ${targetDetect}`
        );
    const isManualMechanicalTool =
        /\b(torquimetro\s+manual|tecle\s+manual|polipasto\s+manual|gata\s+mecanica|herramienta\s+manual|sin\s+energia\s+externa)\b/.test(
            `${normTypeAndCategory} ${targetDetect}`
        ) && !/\b(diesel|electric|bateria|hidraulic|neumatic)\b/.test(targetDetect);

    if (isManualMechanicalTool) {
        energySource = 'MANUAL_MECANICO';
    } else if (isHighPressure700BarTool) {
        energySource = 'HIDRAULICO_AUXILIAR';
    } else if (isTowedNonSelfPropelled && !/\b(motor\s+diesel\s+propio|autopropulsad)\b/.test(targetDetect)) {
        energySource = 'REMOLCADO_SIN_PROPULSION_PROPIA';
    } else if (/\bdual[- ]?fuel\b/.test(targetDetect)) {
        energySource = 'DUAL_FUEL_DIESEL_GAS';
    } else if (/\bhibrid/.test(targetDetect)) {
        energySource = /\b(gasolina|bencina)\b/.test(targetDetect)
            ? 'HIBRIDO_GASOLINA_ELECTRICO'
            : 'HIBRIDO_DIESEL_ELECTRICO';
    } else if (/\b(glp|gnv|gnl|gas\s+licuado|gas\s+natural)\b/.test(targetDetect)) {
        energySource = 'GLP_GNV';
    } else if (/\b(perforadora\s+neumatica|martillo\s+neumatico|aire\s+comprimido)\b/.test(targetDetect) && !/\b(motor\s+diesel|turbodiesel)\b/.test(targetDetect)) {
        energySource = 'NEUMATICO_AIRE_COMPRIMIDO';
    } else if (/\b(bateria\s+bev|el[eé]ctrico\s+bater[ií]a|100%\s+el[eé]ctric|bev|bateria\s+li-?ion|bateria\s+lfp|dron|rpas|uav)\b/.test(`${normTypeAndCategory} ${targetDetect}`) && !/\b(motor\s+diesel|turbodiesel|alternador\s+24\s*v|baterias?\s+12\s*v)\b/.test(targetDetect)) {
        energySource = 'ELECTRICO_BATERIA_BEV';
    } else if (/\b(el[eé]ctrico\s+red|red\s+trif[aá]sica|alimentaci[oó]n\s+el[eé]ctrica\s+ac|pala\s+electrica\s+de\s+cables|bomba\s+sumergible\s+trifasica)\b/.test(`${normTypeAndCategory} ${targetDetect}`) && !/\b(motor\s+diesel|turbodiesel)\b/.test(targetDetect)) {
        energySource = 'ELECTRICO_RED_AC';
    } else if (/\b(gasolina|bencina|nafta)\b/.test(targetDetect) && !/\b(diesel|turbodiesel|ulsd)\b/.test(targetDetect)) {
        energySource = 'GASOLINA';
    } else if (/\b(diesel|turbodiesel|ulsd|common[- ]?rail|inyeccion\s+directa|tier\s+[234]|stage\s+[iiiv]+|euro\s+[3456])\b/.test(targetDetect)) {
        energySource = 'DIESEL';
    }

    const isRoadOrTruck = /\b(camion|tolva|volquete|aljibe|lubricador|pluma|mixer|hormigonero|tractocamion|camioneta|pick\s*up|automovil|suv|furgon|utilitario|van|bus|minibus)\b/.test(
        normTypeAndCategory
    ) && !/\b(caex|camion\s+de\s+extraccion|ultra\s*class)\b/.test(normTypeAndCategory);
    const isCyclicBatteryAsset = /\b(dron|rpas|uav|herramienta\s+inalambrica|llave\s+de\s+impacto\s+bateria)\b/.test(
        normTypeAndCategory
    );

    let costDriverUnit: ReturnType<typeof deriveEnergyConsumptionProfile>['cost_driver_unit'] = 'L/h';
    if (energySource === 'MANUAL_MECANICO') {
        costDriverUnit = '0 L/h (Manual)';
    } else if (energySource === 'REMOLCADO_SIN_PROPULSION_PROPIA') {
        costDriverUnit = '0 L/h (Remolcado)';
    } else if (energySource === 'NEUMATICO_AIRE_COMPRIMIDO') {
        costDriverUnit = 'L/s';
    } else if (energySource === 'HIDRAULICO_AUXILIAR') {
        costDriverUnit = isHighPressure700BarTool ? 'bar (700 bar Hidr.)' : 'L/min';
    } else if (energySource === 'ELECTRICO_RED_AC') {
        costDriverUnit = 'kWh/h';
    } else if (energySource === 'ELECTRICO_BATERIA_BEV') {
        costDriverUnit = isRoadOrTruck ? 'kWh/100km' : isCyclicBatteryAsset ? 'kWh/ciclo' : 'kWh/h';
    } else if (isRoadOrTruck && /\b(km\/l|l\/100\s*km)\b/i.test(corpusText)) {
        costDriverUnit = 'km/L';
    }

    const extractRegexMatch = (re: RegExp, sourceStr: string = corpusText): string | null => {
        const m = sourceStr.match(re);
        return m && m[1] ? m[1].replace(/\s+/g, ' ').trim() : null;
    };

    const corpusLines = corpusText.split(/\r?\n/);

    let highwayKmPerLiter: string | null = prev?.road_haul_efficiency?.highway_km_per_liter || null;
    let highwayLitersPer100Km: string | null = prev?.road_haul_efficiency?.highway_liters_per_100km || null;
    let offroadKmPerLiter: string | null = prev?.road_haul_efficiency?.offroad_km_per_liter || null;
    let offroadLitersPer100Km: string | null = prev?.road_haul_efficiency?.offroad_liters_per_100km || null;
    let estimatedRangeKm: string | null = prev?.road_haul_efficiency?.estimated_range_km || null;

    let idleOrPtoLine: string | null = null;
    let lowLoadLine: string | null = null;
    let mediumLoadLine: string | null = null;
    let highLoadLine: string | null = null;

    let explicitNoDefInCorpus = false;

    for (const rawLine of corpusLines) {
        const line = rawLine.trim();
        if (!line) continue;

        const hasKmL = /\b\d{1,2}(?:[.,]\d+)?(?:\s*[-–a]\s*\d{1,2}(?:[.,]\d+)?)?\s*km\/L\b/i.test(line);
        const hasL100 = /\b\d{1,3}(?:[.,]\d+)?(?:\s*[-–a]\s*\d{1,3}(?:[.,]\d+)?)?\s*L\/100\s*km\b/i.test(line);

        if (hasKmL || hasL100) {
            const kml = extractRegexMatch(/\b(\d{1,2}(?:[.,]\d+)?(?:\s*[-–a]\s*\d{1,2}(?:[.,]\d+)?)?\s*km\/L)\b/i, line);
            const l100 = extractRegexMatch(/\b(\d{1,3}(?:[.,]\d+)?(?:\s*[-–a]\s*\d{1,3}(?:[.,]\d+)?)?\s*L\/100\s*km)\b/i, line);

            if (/\b(fuera\s+de\s+carretera|off[- ]?road|faena|faenero|camino\s+minero|urbano|botadero|rampa|severo)\b/i.test(line) && !/\bcarretera\s*\/\s*traslado\b/i.test(line)) {
                if (kml && !offroadKmPerLiter) offroadKmPerLiter = kml;
                if (l100 && !offroadLitersPer100Km) offroadLitersPer100Km = l100;
            } else if (/\b(carretera|ruta|pavimentad|homologad|traslado|autopista|interurban)\b/i.test(line)) {
                if (kml && !highwayKmPerLiter) highwayKmPerLiter = kml;
                if (l100 && !highwayLitersPer100Km) highwayLitersPer100Km = l100;
            }
        }

        if (/\b(autonom[ií]a\s+vial|autonom[ií]a\s+en\s+ruta|alcance\s+vial|rango\s+vial)\b/i.test(line)) {
            const rangeMatch = extractRegexMatch(
                /\b(\d{2,4}(?:[.,]\d+)?(?:\s*km)?(?:\s*(?:[-–a]|to)\s*\d{2,4}(?:[.,]\d+)?)?\s*km\b)/i,
                line
            );
            if (rangeMatch && !estimatedRangeKm) estimatedRangeKm = rangeMatch;
        }

        // Tasas horarias por factor de carga desde líneas/filas específicas
        const lhInLine = extractRegexMatch(
            /\b(\d{1,3}(?:[.,]\d+)?(?:\s*(?:L\/h|kWh\/h))?(?:\s*[-–a/]\s*\d{1,3}(?:[.,]\d+)?){0,2}\s*(?:L\/h|kWh\/h))\b/i,
            line
        );
        if (lhInLine && !/\b(def|adblue|urea)\b/i.test(line)) {
            if (/\b(ralent[ií]|idle|espera)\b/i.test(line) && !/\bcarga\s+baja\b/i.test(line)) {
                if (!idleOrPtoLine) idleOrPtoLine = lhInLine;
            } else if (/\b(carga\s+baja|factor\s+de\s+carga\s+bajo|25\s*[-–a]\s*35\s*%|pto\s+ligero|baja\s+demanda)\b/i.test(line)) {
                if (!lowLoadLine) lowLoadLine = lhInLine;
            } else if (/\b(carga\s+media|factor\s+de\s+carga\s+medio|50\s*[-–a]\s*65\s*%|nominal|ciclo\s+mixto|ciclo\s+t[ií]pico)\b/i.test(line)) {
                if (!mediumLoadLine) mediumLoadLine = lhInLine;
            } else if (/\b(carga\s+alta|factor\s+de\s+carga\s+alto|80\s*[-–a]\s*100\s*%|plena\s+carga|carga\s+severa)\b/i.test(line)) {
                if (!highLoadLine) highLoadLine = lhInLine;
            }
        }

        if (
            /\b(def\b|adblue|urea|scr\b)\b/i.test(line) &&
            /\b(no\s+aplica|sin\s+scr|sin\s+adblue|no\s+requiere|no\s+utiliza|sin\s+sistema\s+scr|export\s+euro\s*(?:3|iii)|tier\s*[23]\s+sin\s+scr)\b/i.test(
                line
            )
        ) {
            explicitNoDefInCorpus = true;
        }
    }

    const bsfcMatch =
        extractRegexMatch(/\b(\d{3}(?:[.,]\d+)?(?:\s*[-–a]\s*\d{3}(?:[.,]\d+)?)?\s*g\/kWh)\b/i) ||
        prev.specific_consumption_bsfc_gkwh ||
        null;

    const kmPerLiterMatch =
        highwayKmPerLiter ||
        extractRegexMatch(/\b(\d{1,2}(?:[.,]\d+)?(?:\s*[-–a]\s*\d{1,2}(?:[.,]\d+)?)?\s*km\/L)\b/i) ||
        offroadKmPerLiter ||
        prev?.road_haul_efficiency?.km_per_liter ||
        null;

    const lPer100KmMatch =
        highwayLitersPer100Km ||
        extractRegexMatch(/\b(\d{1,3}(?:[.,]\d+)?(?:\s*[-–a]\s*\d{1,3}(?:[.,]\d+)?)?\s*L\/100\s*km)\b/i) ||
        offroadLitersPer100Km ||
        prev?.road_haul_efficiency?.liters_per_100km ||
        null;

    const kwhPer100KmMatch =
        extractRegexMatch(/\b(\d{1,3}(?:[.,]\d+)?(?:\s*[-–a]\s*\d{1,3}(?:[.,]\d+)?)?\s*kWh\/100\s*km)\b/i) ||
        prev?.road_haul_efficiency?.kwh_per_100km ||
        null;

    const lhRangeMatch =
        mediumLoadLine ||
        (consumptionSlot?.value_si && /\b(L\/h|kWh\/h)\b/i.test(consumptionSlot.value_si)
            ? consumptionSlot.value_si
            : null) ||
        extractRegexMatch(/\b(\d{1,3}(?:[.,]\d+)?(?:\s*[-–a/]\s*\d{1,3}(?:[.,]\d+)?){0,2}\s*(?:L\/h|kWh\/h))\b/i) ||
        prev?.hourly_consumption_by_load?.medium_load_50_65pct ||
        null;

    const pneumaticFlowMatch =
        extractRegexMatch(/\b(\d{1,4}(?:[.,]\d+)?\s*(?:L\/s|m³\/min|m3\/min)(?:\s*\([^)]+\))?)\b/i) ||
        (energySource === 'NEUMATICO_AIRE_COMPRIMIDO' ? consumptionSlot?.value_si || null : null) ||
        prev.pneumatic_or_hydraulic_flow ||
        null;

    const defPctRaw = extractRegexMatch(
        /(?:def|adblue)[^\n]{0,65}?(\d{1,2}(?:[.,]\d+)?(?:\s*[-–a]\s*\d{1,2}(?:[.,]\d+)?)?\s*%)/i
    );
    const defTankRaw = extractRegexMatch(
        /(?:estanque|tanque|capacidad)[^\n]{0,35}?(?:def|adblue|urea)[^\n]{0,45}?(\d{1,3}(?:[.,]\d+)?\s*L\b)(?!\s*\/\s*(?:h|hr|min|s|100\s*km))/i
    );

    const requiresDef = explicitNoDefInCorpus
        ? false
        : Boolean(
              defPctRaw ||
                  defTankRaw ||
                  (/\b(adblue|reducci[oó]n\s+catal[ií]tica\s+selectiva\s+scr)\b/i.test(corpusText) &&
                      !/\b(no\s+aplica|sin\s+scr|sin\s+adblue)\b/i.test(corpusText)) ||
                  prev?.def_adblue_consumption?.requires_def
          );

    const defTankMatch = requiresDef
        ? defTankRaw ||
          (prev?.def_adblue_consumption?.tank_capacity_liters &&
          !/^1[.,]5\s*L$/i.test(prev.def_adblue_consumption.tank_capacity_liters)
              ? prev.def_adblue_consumption.tank_capacity_liters
              : null)
        : null;

    const defPctMatch = requiresDef
        ? defPctRaw || prev?.def_adblue_consumption?.consumption_pct_of_fuel || null
        : null;

    const tankCapMatch =
        extractRegexMatch(
            /(?:estanque\s+de\s+combustible|tanque\s+de\s+combustible|capacidad\s+(?:neta\s+)?(?:de\s+)?(?:estanque|tanque|combustible|bater[ií]a))[^\n]{0,65}?(\d{1,4}(?:[.,]\d+)?(?:\s*(?:a|-|–)\s*\d{1,4}(?:[.,]\d+)?)?\s*(?:L\b|litros?|kWh))(?!\s*\/)/i
        ) ||
        capacitySlot?.value_si ||
        prev?.storage_and_autonomy?.tank_or_battery_capacity ||
        null;

    const autonomyHoursMatch = extractRegexMatch(
        /autonom[ií]a(?:\s+operativa)?[^\n]{0,65}?(\d{1,4}(?:[.,]\d+)?(?:\s*[-–a]\s*\d{1,4}(?:[.,]\d+)?)?\s*(?:h\b|horas))/i
    );
    const autonomyKmMatch =
        estimatedRangeKm ||
        extractRegexMatch(
            /autonom[ií]a(?:\s+vial)?[^\n]{0,65}?(\d{2,4}(?:[.,]\d+)?(?:\s*[-–a]\s*\d{2,4}(?:[.,]\d+)?)?\s*km\b)/i
        );

    const autonomyMatch =
        [autonomyKmMatch, autonomyHoursMatch].filter(Boolean).join(' · ') ||
        prev?.storage_and_autonomy?.estimated_autonomy ||
        null;

    return {
        energy_source: energySource,
        energy_spec_label: sourceSlot?.value_si || prev.energy_spec_label || null,
        cost_driver_unit: costDriverUnit,
        hourly_consumption_by_load: {
            idle_or_pto: idleOrPtoLine || prev?.hourly_consumption_by_load?.idle_or_pto || null,
            low_load_25_35pct: lowLoadLine || prev?.hourly_consumption_by_load?.low_load_25_35pct || null,
            medium_load_50_65pct: lhRangeMatch,
            high_load_80_100pct: highLoadLine || prev?.hourly_consumption_by_load?.high_load_80_100pct || null,
        },
        road_haul_efficiency: {
            km_per_liter: kmPerLiterMatch,
            liters_per_100km: lPer100KmMatch,
            kwh_per_100km: kwhPer100KmMatch,
            highway_km_per_liter: highwayKmPerLiter || kmPerLiterMatch,
            highway_liters_per_100km: highwayLitersPer100Km || lPer100KmMatch,
            offroad_km_per_liter: offroadKmPerLiter,
            offroad_liters_per_100km: offroadLitersPer100Km,
            estimated_range_km: autonomyKmMatch,
        },
        specific_consumption_bsfc_gkwh: bsfcMatch,
        pneumatic_or_hydraulic_flow: pneumaticFlowMatch,
        def_adblue_consumption: {
            requires_def: requiresDef,
            consumption_pct_of_fuel: defPctMatch,
            tank_capacity_liters: defTankMatch,
        },
        storage_and_autonomy: {
            tank_or_battery_capacity: tankCapMatch,
            estimated_autonomy: autonomyMatch,
        },
        source_url:
            consumptionSlot?.source_url ||
            sourceSlot?.source_url ||
            capacitySlot?.source_url ||
            params.official_url ||
            prev.source_url ||
            null,
        updated_at: new Date().toISOString(),
    };
}

const FORBIDDEN_GENERIC_BULLET_TOKENS = new Set([
    'superficie',
    'operacion tecnica',
    'operacion industrial',
    'operacion minera',
    'operacion general',
    'uso general',
    'uso industrial',
    'general',
    'estandar',
    'standard',
    'terreno',
    'exterior',
    'interior',
    'faena',
    'construccion',
    'mineria',
    'industrial',
    'no declarado',
    'n/a',
    'na',
]);

const PURE_NEGATIVE_BULLET_START_REGEX =
    /^(?:no\s+aplica\b|n\s*\/\s*a\b|sin\s+(?:sistema|equipamiento|adblue|def\b|scr\b|urea|dpf|egr|bater[ií]a\s+de\s+tracci[oó]n|combustible|estanque)|no\s+(?:posee|equipa|requiere|incorpora|utiliza|dispone\s+de|cuenta\s+con)\b|ausencia\s+de\b|inexistencia\s+de\b|exento\s+de\b)/i;

const INLINE_NEGATIVE_SUBSYSTEM_PARENTHETICAL_REGEX =
    /\(\s*(?:configuraci[oó]n\s+(?:de\s+motor\s+)?sin\s+[^)]+|no\s+aplica[^)]*|sin\s+(?:sistema\s+|uso\s+de\s+|requerir\s+)?(?:scr|adblue|def\b|urea|dpf|egr|doc\b|postratamiento|bater[ií]a\s+de\s+tracci[oó]n|combustible)[^)]*|no\s+(?:posee|equipa|requiere|incorpora)[^)]*|exento\s+de\s+[^)]*|ausencia\s+de\s+[^)]*)\s*\)/gi;

const TRAILING_NEGATIVE_SUBSYSTEM_CLAUSE_REGEX =
    /(?:[,;—–-]\s*|\s+)(?:sin\s+(?:sistema\s+|requerir\s+|necesidad\s+de\s+|uso\s+de\s+)?(?:scr\b|adblue\b|def\b|urea\b|dpf\b|egr\b|doc\b|postratamiento|bater[ií]a\s+de\s+tracci[oó]n|combustible)[a-z0-9/._\s-]*|no\s+(?:posee|equipa|requiere|incorpora)\s+(?:sistema\s+)?(?:scr\b|adblue\b|def\b|urea\b|dpf\b|egr\b)[a-z0-9/._\s-]*|exento\s+de\s+(?:sistema\s+)?(?:scr\b|adblue\b|def\b|urea\b|dpf\b)[a-z0-9/._\s-]*)$/i;

const TRAILING_BROCHURE_FLUFF_CLAUSE_REGEX =
    /\s+(?:dise[ñn]ad[oa]\s+para|orientad[oa]\s+a|enfocad[oa]\s+en)\s+(?:reducci[oó]n\s+de\s+ruido\s+y\s+)?(?:confort|comodidad|ergonom[ií]a\s+y\s+confort|mayor\s+productividad|m[aá]xima\s+eficiencia)[^.,;]*$/i;

const TAUTOLOGICAL_CONFIG_MOBILITY_REGEX =
    /^configuraci[oó]n\s+de\s+[a-z0-9áéíóúüñ\s/-]+\s+para\s+(?:movilidad|desplazamiento|traslado|operaci[oó]n|trabajo)\s+en\s+(?:superficies?|terrenos?|faenas?|obras?)(?:\s+de\s+[a-záéíóúüñ\s]+)?$/i;

const TECHNICAL_NORM_OR_CODE_TOKEN_REGEX =
    /\b(?:iso|sae|din|iec|epa|tier|stage|euro|ip\d{2}|rops|fops|atex|nfpa|xhp|lgp|awd|4wd|2wd|[468]x[2468]|allison|mdrive|powershift|hidrost[aá]tic[oa]|[a-z]{1,4}\d[a-z0-9.-]*)\b/i;

function cleanPositivePresenceBulletClause(raw: string): string {
    return raw
        .replace(INLINE_NEGATIVE_SUBSYSTEM_PARENTHETICAL_REGEX, '')
        .replace(TRAILING_NEGATIVE_SUBSYSTEM_CLAUSE_REGEX, '')
        .replace(TRAILING_BROCHURE_FLUFF_CLAUSE_REGEX, '')
        .replace(/\s+de\s+alto\s+rendimiento(?=\s*\([A-Z0-9]{2,6}\))/gi, '')
        .replace(/\s+para\s+gesti[oó]n\s+de\s+flujo\s+en\s+aplicaciones\s+de\s+alta\s+demanda$/i, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/[,;—–-]\s*$/, '')
        .trim();
}

/**
 * Purga viñetas genéricas de 1–2 palabras ("Superficie", "Operación Técnica"), cláusulas negativas
 * de subsistemas inexistentes ("sin sistema SCR/AdBlue"), relleno comercial ("confort del operador",
 * "aplicaciones de alta demanda"), tautologías del TIPO y duraciones de turno inventadas ("8 a 10 horas")
 * en `ambiente_operativo` (`CONDICIONES DE DISEÑO`) y `contexto_operativo` (`CONTEXTO Y TRABAJO`).
 * Si tras la purga no quedan especificaciones técnicas reales, aplica política Fail-Closed honesta:
 * `["[Información técnica no declarada en ficha]"]`.
 */
export function sanitizeDesignAndWorkContextItems(
    rawItems: unknown,
    fallbackSourceItems?: unknown,
    options?: { canonicalTypeEs?: string | null }
): string[] {
    const normCanonicalType = options?.canonicalTypeEs
        ? stripTextAccents(String(options.canonicalTypeEs)).replace(/[.,;:]/g, '').trim()
        : '';

    const filterList = (input: unknown): string[] => {
        if (!Array.isArray(input)) return [];
        const out: string[] = [];
        const seen = new Set<string>();
        for (const item of input) {
            const rawTrimmed = String(item || '')
                .replace(/^[•\-*]\s*/, '')
                .replace(/\s+/g, ' ')
                .trim();
            if (!rawTrimmed) continue;
            if (rawTrimmed === MISSING_FULL_TECH_SPEC || rawTrimmed === MISSING_AXIS_VALUE) continue;
            if (PURE_NEGATIVE_BULLET_START_REGEX.test(rawTrimmed)) continue;

            const clean = cleanPositivePresenceBulletClause(rawTrimmed);
            if (!clean) continue;
            if (PURE_NEGATIVE_BULLET_START_REGEX.test(clean)) continue;
            if (FORBIDDEN_MARKETING_OR_UNVERIFIED_CLAIM_REGEX.test(clean)) continue;

            const hasMetricOrNorm =
                ANY_ENGINEERING_METRIC_REGEX.test(clean) || TECHNICAL_NORM_OR_CODE_TOKEN_REGEX.test(clean);

            if (!hasMetricOrNorm && TAUTOLOGICAL_CONFIG_MOBILITY_REGEX.test(clean)) {
                continue;
            }

            const norm = stripTextAccents(clean).replace(/[.,;:]/g, '').trim();
            if (!norm || FORBIDDEN_GENERIC_BULLET_TOKENS.has(norm)) continue;

            if (
                normCanonicalType &&
                normCanonicalType.length >= 6 &&
                !hasMetricOrNorm &&
                (norm === normCanonicalType ||
                    norm.startsWith(`configuracion de ${normCanonicalType}`) ||
                    norm.startsWith(`equipo tipo ${normCanonicalType}`))
            ) {
                continue;
            }

            // Exigir contenido técnico real (>= 10 caracteres o al menos 1 magnitud/norma de ingeniería)
            if (norm.length < 10 && !hasMetricOrNorm) continue;
            if (seen.has(norm)) continue;
            seen.add(norm);
            out.push(clean);
        }
        return out;
    };

    const primary = filterList(rawItems);
    if (primary.length > 0) return primary.slice(0, 6);

    const secondary = filterList(fallbackSourceItems);
    if (secondary.length > 0) return secondary.slice(0, 6);

    return [MISSING_FULL_TECH_SPEC];
}

export function hasOnlyGenericOrMissingContextItems(
    items: unknown,
    options?: { canonicalTypeEs?: string | null }
): boolean {
    if (!Array.isArray(items) || items.length === 0) return true;
    const sanitized = sanitizeDesignAndWorkContextItems(items, undefined, options);
    return sanitized.length === 1 && sanitized[0] === MISSING_FULL_TECH_SPEC;
}

const EDITORIAL_OR_SPECULATIVE_HEADING_REGEX =
    /^(?:#{1,6}\s+|\*\*|__)?\s*(?:directiva\s+de\s+c[aá]lculo|gesti[oó]n\s+de\s+autonom[ií]a|nota\s+(?:de\s+modelamiento|metodol[oó]gica|sobre\s+tco|editorial|aclaratoria)|modelamiento\s+(?:de\s+)?tco|criterios?\s+de\s+estimaci[oó]n\s+tco|consideraciones?\s+de\s+autonom[ií]a|observaci[oó]n\s+sobre\s+subsistemas\s+no\s+equipados)\b[^|]*$/i;

const SPECULATIVE_OR_NEGATIVE_PARAGRAPH_REGEX =
    /\b(?:para\s+efectos\s+de\s+modelamiento\s+de\s+costo\s+total|turno\s+est[aá]ndar\s+de\s+\d+\s*(?:a|-|–)\s*\d+\s*(?:horas?|h\b)|ciclos?\s+de\s+trabajo\s+continuos?\s+de\s+\d+\s*(?:a|-|–)\s*\d+\s*(?:horas?|h\b)|no\s+incurre\s+en\s+costos\s+operativos\s+asociados\s+al\s+consumo\s+de\s+(?:fluido|adblue|def|urea)|(?:el|este)\s+equipo\s+no\s+(?:posee|equipa|cuenta\s+con|incorpora|requiere)\s+(?:sistema\s+)?(?:scr|adblue|def|dpf|egr|bater[ií]a\s+de\s+tracci[oó]n))\b/i;

const NON_APPLICABLE_CELL_VALUE_REGEX =
    /^(?:[*_`~]+\s*)*(?:no\s+aplica\b|n\s*\/\s*a\s*(?:\([^)]*\))?\s*$|no\s+(?:posee|equipa|incorpora|dispone\s+de|cuenta\s+con)\b|no\s+requiere\s+(?:adblue|def\b|scr\b|urea|dpf\b|combustible|postratamiento)|sin\s+(?:sistema\b|equipamiento\b|adblue\b|def\b|scr\b|urea\b|dpf\b|egr\b|doc\b|catalizador\s+scr|estanque\s+de\s+(?:adblue|def|urea|combustible)|banco\s+de\s+bater[ií]as|bater[ií]a\s+de\s+tracci[oó]n|postratamiento\s+scr)|ausencia\s+de\s+(?:sistema|scr|adblue|def|dpf|egr)|inexistencia\s+de\b|exento\s+de\s+(?:scr|adblue|def|dpf|consumo\s+de\s+fluido))/i;

const OPTIONAL_SUBSYSTEM_PARAM_CELL_REGEX =
    /\b(?:scr\b|adblue|def\b|urea|dpf\b|bater[ií]a\s+de\s+tracci[oó]n|banco\s+de\s+bater[ií]as|pant[oó]grafo|trolley|estabilizadores|outriggers|quinta\s+rueda|ripper)\b/i;

const INLINE_NEGATIVE_CELL_ASSERTION_REGEX =
    /\b(?:no\s+aplica|sin\s+(?:sistema\s+)?(?:scr\b|adblue|def\b|urea|dpf\b|estabilizadores|bater[ií]a\s+de\s+tracci[oó]n)|no\s+(?:posee|equipa|incorpora|requiere|dispone\s+de)|exento\s+de\s+(?:scr|adblue|def|dpf))\b/i;

const EXPLICIT_VISUAL_CITATION_LINE_REGEX =
    /\b(?:seg[uú]n\s+(?:el|la|los|las)?\s*(?:esquema|diagrama|plano|figura|ilustraci[oó]n|imagen|curva)|ver\s+(?:el|la)?\s*(?:esquema|diagrama|figura|ilustraci[oó]n|imagen|plano|curva)|(?:ilustrad[oa]s?|indicad[oa]s?|mostrad[oa]s?|se[nñ]alad[oa]s?|representad[oa]s?)\s+en\s+(?:el|la)\s+(?:figura|diagrama|esquema|ilustraci[oó]n|plano|curva)|ubicaci[oó]n\s+en\s+(?:el|la)?\s*(?:diagrama|esquema|figura)|\b(?:fig\.|figura)\s*\d+)/i;

function splitMarkdownTableCells(rowLine: string): string[] {
    return rowLine
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => c.trim());
}

function isMarkdownTableSeparatorCells(cells: string[]): boolean {
    return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '');
}

/**
 * Sanitizador determinista post-inferencia de Presencia Positiva Estricta (`v9.6`):
 * 1. Elimina filas de tabla cuyo valor sea `"No aplica..."`, `"N/A"`, `"Sin sistema SCR/AdBlue"`,
 *    `"No posee..."` o `"Exento de..."`, preservando intacto `[Información técnica no declarada en ficha]`.
 * 2. Limpia paréntesis negativos incrustados en celdas válidas (ej. `"(sin sistema SCR/AdBlue)"`).
 * 3. Elimina bloques editoriales especulativos (`"Directiva de Cálculo TCO y Gestión de Autonomía:"`,
 *    `"turno estándar de 8 a 10 horas"`, `"no incurre en costos operativos asociados al consumo de fluido..."`).
 * 4. En `pillarId === 'ficha_tecnica'`, garantiza pureza 100% tabular + encabezados + marcadores de figuras.
 */
export function sanitizePositivePresenceMarkdown(
    markdown: string,
    options?: { pillarId?: string }
): string {
    const raw = String(markdown || '');
    if (!raw.trim()) return raw;

    const lines = raw.replace(/\r\n/g, '\n').split('\n');
    const stage1Lines: string[] = [];
    let i = 0;
    let skippingEditorialBlock = false;

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        // Procesamiento íntegro de bloques de tabla Markdown
        if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
            skippingEditorialBlock = false;
            const tableBlock: string[] = [];
            while (i < lines.length && lines[i].trim().startsWith('|')) {
                tableBlock.push(lines[i]);
                i++;
            }

            const headerAndSep: string[] = [];
            const keptBodyRows: string[] = [];
            let headerSeen = false;
            let hadBodyRows = false;

            for (const tRow of tableBlock) {
                const cells = splitMarkdownTableCells(tRow);
                if (isMarkdownTableSeparatorCells(cells)) {
                    headerAndSep.push(tRow);
                    continue;
                }
                if (!headerSeen) {
                    headerSeen = true;
                    headerAndSep.push(tRow);
                    continue;
                }

                hadBodyRows = true;
                const isIndexedChecklistRow = /^\d{1,3}$/.test(cells[0] || '');
                const paramCell = isIndexedChecklistRow ? cells[1] || '' : cells[0] || '';

                const hasPureNonApplicableCell = cells.some((c) => NON_APPLICABLE_CELL_VALUE_REGEX.test(c));
                const isNegativeOptionalSubsystemRow =
                    OPTIONAL_SUBSYSTEM_PARAM_CELL_REGEX.test(paramCell) &&
                    cells.slice(isIndexedChecklistRow ? 2 : 1).some((c) => INLINE_NEGATIVE_CELL_ASSERTION_REGEX.test(c));

                if (hasPureNonApplicableCell || isNegativeOptionalSubsystemRow) {
                    continue;
                }

                // Limpiar paréntesis negativos residuales en celdas válidas (sin tocar placeholders `[Información...]`)
                const cleanedCells = cells.map((cell, cellIdx) => {
                    if (cellIdx === 0 && !isIndexedChecklistRow) return cell;
                    if (cell.startsWith('[') && cell.endsWith(']')) return cell;
                    const stripped = cell
                        .replace(INLINE_NEGATIVE_SUBSYSTEM_PARENTHETICAL_REGEX, '')
                        .replace(/\s{2,}/g, ' ')
                        .trim();
                    return stripped || cell;
                });

                const originalCleanedEqual = cleanedCells.every((c, idx) => c === cells[idx]);
                keptBodyRows.push(originalCleanedEqual ? tRow : `| ${cleanedCells.join(' | ')} |`);
            }

            if (!hadBodyRows || keptBodyRows.length > 0) {
                stage1Lines.push(...headerAndSep, ...keptBodyRows);
            }
            continue;
        }

        // Detectar inicio de bloque editorial/especulativo no solicitado
        if (trimmed && EDITORIAL_OR_SPECULATIVE_HEADING_REGEX.test(trimmed)) {
            skippingEditorialBlock = true;
            i++;
            continue;
        }

        if (skippingEditorialBlock) {
            if (!trimmed) {
                i++;
                continue;
            }
            const isNextValidSectionHeading =
                /^#{1,6}\s+/.test(trimmed) && !EDITORIAL_OR_SPECULATIVE_HEADING_REGEX.test(trimmed);
            const isFigureOrSymbolMarker =
                /^!\[/.test(trimmed) || /^\[(?:IMAGEN[_\s-]PENDIENTE|FIGURA|DIAGRAMA|S[ÍI]MBOLO)\b/i.test(trimmed);
            if (isNextValidSectionHeading || isFigureOrSymbolMarker) {
                skippingEditorialBlock = false;
                // No incrementar `i`: procesar esta línea normalmente
                continue;
            }
            // Descartar párrafo/viñeta perteneciente al bloque editorial
            i++;
            continue;
        }

        // Descartar párrafos especulativos sueltos fuera de tablas
        if (trimmed && SPECULATIVE_OR_NEGATIVE_PARAGRAPH_REGEX.test(trimmed)) {
            i++;
            continue;
        }

        stage1Lines.push(line);
        i++;
    }

    // Etapa 2: En Pilar 01 (`ficha_tecnica`), imponer pureza 100% tabular si existe al menos una tabla
    const hasAnyTable = stage1Lines.some((l) => l.trim().startsWith('|'));
    const stage2Lines =
        options?.pillarId === 'ficha_tecnica' && hasAnyTable
            ? stage1Lines.filter((l) => {
                  const t = l.trim();
                  if (!t) return true;
                  if (/^#{1,6}\s+/.test(t)) return true;
                  if (t.startsWith('|')) return true;
                  if (/^!\[/.test(t) || /^\[(?:IMAGEN[_\s-]PENDIENTE|FIGURA|DIAGRAMA|S[ÍI]MBOLO)\b/i.test(t)) {
                      return true;
                  }
                  if (t.length <= 160 && EXPLICIT_VISUAL_CITATION_LINE_REGEX.test(t)) {
                      return true;
                  }
                  return false;
              })
            : stage1Lines;

    // Etapa 3: Podar encabezados `##`..`######` huérfanos que hayan quedado vacíos tras eliminar filas/párrafos
    const stage3Lines: string[] = [];
    for (let idx = 0; idx < stage2Lines.length; idx++) {
        const line = stage2Lines[idx];
        const trimmed = line.trim();
        const headingMatch = trimmed.match(/^(#{2,6})\s+/);
        if (headingMatch) {
            const currentLevel = headingMatch[1].length;
            let hasSectionBody = false;
            for (let lookahead = idx + 1; lookahead < stage2Lines.length; lookahead++) {
                const nextTrimmed = stage2Lines[lookahead].trim();
                if (!nextTrimmed) continue;
                const nextHeading = nextTrimmed.match(/^(#{1,6})\s+/);
                if (nextHeading && nextHeading[1].length <= currentLevel) {
                    break;
                }
                if (!nextHeading) {
                    hasSectionBody = true;
                    break;
                }
            }
            if (!hasSectionBody) {
                continue;
            }
        }
        stage3Lines.push(line);
    }

    const finalMarkdown = stage3Lines
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    return finalMarkdown.length > 0 ? finalMarkdown : raw.trim();
}

/**
 * Resolución determinista ultra-rápida (< 1 ms, $0 IA) del `TIPO` canónico a partir del par
 * `(Marca, Código de Modelo / Serie)` para evitar llamadas LLM redundantes en el Paso 1.
 */
export function detectDeterministicEquipmentTypeFromBrandAndModel(
    rawInput: string
): {
    correctedMake: string;
    correctedModel: string;
    type_key: string;
    canonical_type_es: string;
    categoria_equipo: string;
} | null {
    const clean = String(rawInput || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .trim();
    if (!clean || clean.length < 3) return null;

    // 1. Caterpillar Skid Steer Loaders (216, 226, 232, 236, 242, 246, 252, 262, 272 + D/D2/D3/XHP/XE)
    const catSsl = clean.match(
        /\b(?:CAT(?:ERPILLAR)?)\s+(2(?:16|26|32|36|42|46|52|62|68|72)[A-Z0-9]*(?:\s+(?:XHP|XE|D|D2|D3))*)\b/
    );
    if (catSsl) {
        return {
            correctedMake: 'CATERPILLAR',
            correctedModel: catSsl[1].trim(),
            type_key: 'minicargador_sobre_neumaticos',
            canonical_type_es: 'MINICARGADOR SOBRE NEUMÁTICOS',
            categoria_equipo: 'CARGUÍO COMPACTO Y MOVIMIENTO DE TIERRA',
        };
    }

    // 2. Caterpillar Compact Track Loaders (239, 249, 255, 259, 265, 275, 279, 285, 289, 299 + D/D2/D3/XHP/XE)
    const catCtl = clean.match(
        /\b(?:CAT(?:ERPILLAR)?)\s+(2(?:39|49|55|57|59|65|75|77|79|85|87|89|97|99)[A-Z0-9]*(?:\s+(?:XHP|XE|D|D2|D3))*)\b/
    );
    if (catCtl) {
        return {
            correctedMake: 'CATERPILLAR',
            correctedModel: catCtl[1].trim(),
            type_key: 'cargador_compacto_sobre_orugas',
            canonical_type_es: 'CARGADOR COMPACTO SOBRE ORUGAS',
            categoria_equipo: 'CARGUÍO COMPACTO Y MOVIMIENTO DE TIERRA',
        };
    }

    // 3. Caterpillar Bulldozers sobre Orugas (D3..D11)
    const catDozer = clean.match(
        /\b(?:CAT(?:ERPILLAR)?)\s+(D(?:3|4|5|6|7|8|9|10|11)[A-Z0-9]*(?:\s+(?:LGP|XE|T|T2|R|N|NEXT\s+GEN))*)\b/
    );
    if (catDozer) {
        return {
            correctedMake: 'CATERPILLAR',
            correctedModel: catDozer[1].trim(),
            type_key: 'bulldozer_sobre_orugas',
            canonical_type_es: 'BULLDOZER SOBRE ORUGAS',
            categoria_equipo: 'MOVIMIENTO DE TIERRA',
        };
    }

    // 4. Caterpillar Motoniveladoras (120, 140, 150, 160, 12M, 14M, 16M, 18M, 24M)
    const catGrader = clean.match(
        /\b(?:CAT(?:ERPILLAR)?)\s+((?:120|140|150|160|12|14|16|18|24)[A-Z0-9]*(?:\s+(?:AWD|LVR|GC))*)\b/
    );
    if (catGrader && /\b(120|140|150|160|12M|14M|16M|18M|24M|14H|16H|24H)\b/.test(catGrader[1])) {
        return {
            correctedMake: 'CATERPILLAR',
            correctedModel: catGrader[1].trim(),
            type_key: 'motoniveladora',
            canonical_type_es: 'MOTONIVELADORA',
            categoria_equipo: 'MOVIMIENTO DE TIERRA Y VIALIDAD',
        };
    }

    // 5. Caterpillar Excavadoras Hidráulicas (312..395)
    const catExc = clean.match(
        /\b(?:CAT(?:ERPILLAR)?)\s+(3(?:12|13|15|18|20|23|25|26|30|36|40|45|49|52|74|90|95)[A-Z0-9]*(?:\s+(?:GC|L|DL|EL|FL|NEXT\s+GEN))*)\b/
    );
    if (catExc) {
        return {
            correctedMake: 'CATERPILLAR',
            correctedModel: catExc[1].trim(),
            type_key: 'excavadora_hidraulica',
            canonical_type_es: 'EXCAVADORA HIDRÁULICA',
            categoria_equipo: 'EXCAVACIÓN Y CARGUÍO',
        };
    }

    // 6. Komatsu Excavadoras Hidráulicas (PC130..PC8000)
    const komExc = clean.match(/\bKOMATSU\s+(PC\s*\d{2,4}[A-Z0-9-]*)\b/);
    if (komExc) {
        return {
            correctedMake: 'KOMATSU',
            correctedModel: komExc[1].replace(/\s+/g, ''),
            type_key: 'excavadora_hidraulica',
            canonical_type_es: 'EXCAVADORA HIDRÁULICA',
            categoria_equipo: 'EXCAVACIÓN Y CARGUÍO',
        };
    }

    // 7. Palas Eléctricas de Cables (Komatsu / P&H 4100XPC, CAT 7495)
    const elecShovel = clean.match(/\b(?:KOMATSU|P&H|P\s+AND\s+H|CAT(?:ERPILLAR)?)\s+(4100\s*XPC|2800\s*XPC|7495[A-Z0-9]*)\b/);
    if (elecShovel) {
        return {
            correctedMake: /7495/.test(elecShovel[1]) ? 'CATERPILLAR' : 'KOMATSU P&H',
            correctedModel: elecShovel[1].replace(/\s+/g, ''),
            type_key: 'pala_electrica_de_cables',
            canonical_type_es: 'PALA ELÉCTRICA DE CABLES',
            categoria_equipo: 'CARGUÍO MINERO GRAN MINERÍA',
        };
    }

    // 8. Drones / RPAS Industriales (DJI Matrice, Mavic Enterprise)
    const djiDrone = clean.match(/\bDJI\s+((?:MATRICE|MAVIC|PHANTOM|AGRAS)\s*[A-Z0-9-]+(?:\s+RTK|\s+ENTERPRISE)*)\b/);
    if (djiDrone) {
        return {
            correctedMake: 'DJI',
            correctedModel: djiDrone[1].trim(),
            type_key: 'dron_rpas_topografico',
            canonical_type_es: 'DRON RPAS TOPOGRÁFICO E INSPECCIÓN',
            categoria_equipo: 'TOPOGRAFÍA, FOTOGRAMETRÍA Y TELEMETRÍA AÉREA',
        };
    }

    // 9. Llaves de Torque Hidráulicas 700 bar (Hytorc, Enerpac)
    const torqueWrench = clean.match(/\b(HYTORC|ENERPAC)\s+((?:AVANTI|MXT|STEALTH|ICE|S\d{3,4}|W\d{3,4})[A-Z0-9-]*)\b/);
    if (torqueWrench) {
        return {
            correctedMake: torqueWrench[1],
            correctedModel: torqueWrench[2].trim(),
            type_key: 'llave_torque_hidraulica',
            canonical_type_es: 'LLAVE DE TORQUE HIDRÁULICA',
            categoria_equipo: 'HERRAMIENTAS DE TORQUE Y TENSIONADO INDUSTRIAL',
        };
    }

    // 10. Bombas Sumergibles de Achique / Drenaje Minero (Grindex, Flygt)
    const subPump = clean.match(/\b(GRINDEX|FLYGT)\s+((?:MAJOR|MASTER|MATADOR|MAXI|MINEX|MINETTE|BIBO|\d{4})[A-Z0-9-]*)\b/);
    if (subPump) {
        return {
            correctedMake: subPump[1],
            correctedModel: subPump[2].trim(),
            type_key: 'bomba_sumergible_achique',
            canonical_type_es: 'BOMBA SUMERGIBLE DE ACHIQUE TRIFÁSICA',
            categoria_equipo: 'BOMBEO E IMPULSIÓN DE FLUIDOS',
        };
    }

    // 11. Chancadores Móviles sobre Orugas (Metso Lokotrack, Sandvik QJ/QH)
    const crusher = clean.match(/\b(METSO(?:\s+OUTOTEC)?|SANDVIK)\s+((?:LOKOTRACK\s+)?(?:LT\d{2,4}[A-Z0-9]*|QJ\d{3}[A-Z0-9]*|QH\d{3}[A-Z0-9]*))\b/);
    if (crusher) {
        return {
            correctedMake: crusher[1].startsWith('METSO') ? 'METSO' : 'SANDVIK',
            correctedModel: crusher[2].trim(),
            type_key: 'chancador_movil_sobre_orugas',
            canonical_type_es: 'CHANCADOR MÓVIL SOBRE ORUGAS',
            categoria_equipo: 'CONMINUCIÓN Y PROCESAMIENTO DE MINERALES',
        };
    }

    return null;
}


