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
    /\b(carga\s+(f[aá]cil\s+)?de\s+camiones|cargu[ií]o\s+de\s+camiones|easier\s+truck\s+loading|truck\s+loading|mayor\s+alcance|alcance\s+extendido|l[ií]der\s+en|insuperable|mejor\s+de\s+su\s+clase|best[- ]in[- ]class|alta\s+eficiencia|m[aá]xima\s+eficiencia|m[aá]xima\s+productividad|[oó]ptimo\s+rendimiento|rendimiento\s+superior|excelente\s+estabilidad|gran\s+versatilidad|dise[ñn]ad[oa]\s+para\s+maximizar|proporciona\s+mayor|ofrece\s+mayor|permite\s+cargar\s+camiones|ideal\s+para|f[aá]cil\s+mantenimiento|comodidad\s+del\s+operador|confort\s+superior)\b/i;

export const ACCESSORY_HISTORICAL_SPEC_REGEX =
    /per[ií]odo\s+de\s+(producci[oó]n|fabricaci[oó]n)|a[ñn]os?\s+de\s+(producci[oó]n|fabricaci[oó]n|lanzamiento|comercializaci[oó]n)|introducid[oa]\s+en|fabricad[oa]\s+(entre|desde|en)|lanzad[oa]\s+en|primera\s+generaci[oó]n|evoluci[oó]n\s+serie|reemplaz[ao]\s+al|sucesor\s+de|antecesor\s+de|pa[ií]s\s+de\s+origen|\b(19|20)\d{2}\s*[-–—/]\s*((19|20)\d{2}|presente|actualidad|hoy)\b|\b(19|20)\d{2}\+\b/i;

const NUM_UNIT_MASS = /\b\d[\d.,]*\s*(?:kg|t\b|ton|toneladas?|lb|lbs)\b/i;
const NUM_UNIT_POWER = /\b\d[\d.,]*\s*(?:kw|hp|cv)\b/i;
const NUM_UNIT_VOLUME = /\b\d[\d.,]*\s*(?:m³|yd³|(?:m3|l|litros?|yd3)\b)(?![a-zA-Z])/i;
const NUM_UNIT_LENGTH = /\b\d[\d.,]*\s*(?:mm|m\b|cm|pulg|in)\b/i;
const NUM_UNIT_FORCE_TORQUE = /\b\d[\d.,]*\s*(?:kn|n[·.\s-]?m|kgf|daN|j\b|joules?|hz|bpm)\b/i;
const NUM_UNIT_FLOW_PRESSURE_ELEC =
    /\b\d[\d.,]*\s*(?:m³\/min|(?:l\/s|l\/min|m3\/min|cfm|bar|mpa|psi|kva|kw|v|volt|a|amp)\b)/i;
export const ANY_ENGINEERING_METRIC_REGEX =
    /\b(\d[\d.,]*\s*(?:m³\/min|m³\/h|m3\/min|m3\/h|l\/min|l\/s|l\/h|km\/h|m\/s|kn[·.\s-]?m|t[·.\s-]?m|n[·.\s-]?m|m\.?c\.?a\.?|m³|m²|cm³|yd³|°c|dba|db|kwh|kva|kw|mw|hp|cv|kgf|kg|toneladas?|ton|lbs?|mm|cm|km|pulg|ft|in|m3|m2|cm3|cc|yd3|litros?|gal|cfm|gpm|mbar|bar|mpa|kpa|psi|kn|kj|hz|khz|mhz|bpm|rpm|mah|ah|wh|kv|mv|volt|amp|[tgwvnajmlh%])\b|[2468]x[2468]|\b(?:awd|4wd|2wd|fwd|rwd|[bhnp]q)\b|\d[\d.,]*\s*°)/i;

const ANY_SI_METRIC = ANY_ENGINEERING_METRIC_REGEX;

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

/**
 * Limpia y valida un valor contra un eje dinámico por `TIPO` (`EquipmentTypeAxisSchemaItem` o `CanonicalSpecSlot` auto-descriptivo).
 * - Rechaza cualquier prosa publicitaria o años históricos de producción.
 * - Si `value_kind === 'CLOSED_ENUM'`, exige pertenencia a `allowed_enum_values` (o enum técnico corto sin verbos comerciales).
 * - Si `value_kind === 'PHYSICAL_MAGNITUDE'`, exige magnitud numérica con unidad de ingeniería SI.
 */
export function cleanDynamicAxisValue(
    rawVal: unknown,
    axisMeta?: {
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
    if (!valueOnly || valueOnly.length > 72) {
        return null;
    }

    if (axisMeta?.value_kind === 'CLOSED_ENUM') {
        if (Array.isArray(axisMeta.allowed_enum_values) && axisMeta.allowed_enum_values.length > 0) {
            const normVal = stripTextAccents(valueOnly);
            const matchedEnum = axisMeta.allowed_enum_values.find(
                (opt) => stripTextAccents(opt) === normVal || normVal.includes(stripTextAccents(opt))
            );
            return matchedEnum || null;
        }
        return valueOnly.length <= 40 ? valueOnly : null;
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
    if (!valueOnly || valueOnly.length > 72) {
        return null;
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

    const slots: CanonicalSpecSlot[] = archetype.axes.map((axis) => {
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
    const { archetype, slots } = extractHomologousAxisValues(record);

    const hasAnyVerifiedValue = slots.some((s) => Boolean(s.value_si));
    if (!hasAnyVerifiedValue) {
        return MISSING_FULL_TECH_SPEC;
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

/**
 * Serializa los `CanonicalSpecSlot[]` verificados hacia `caracteristicas_principales: string[]`
 * para mantener compatibilidad limpia con los 5 pilares de la bóveda (`Itemizer` / `ItemHunter`).
 */
export function serializeCanonicalSlotsToSpecsArray(slots: CanonicalSpecSlot[]): string[] {
    const valid = slots
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
