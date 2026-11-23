/**
 * MINREPORT · ABASTECIMIENTO — Catálogo Canónico Semilla v3.0, Taxonomía de 15 Canales WS y Perfiles Base
 *
 * Provee:
 * - Seed determinístico unificado (`SKU-*`) para `global_supply_catalog` + tabla de alias `LEGACY_SKU_ID_ALIAS_MAP`.
 * - Separación logística estricta Campamento vs Producción/Flota en los 15 rubros (`ProcurementBucket`),
 *   21 categorías (`SupplyCategoryCode`) y 11 centros de costo (`CC-*`).
 * - Metadatos de los 15 Canales WhatsApp Especializados (`SUPPLY_CHANNELS_META`, `getChannelsForProfileRole`,
 *   `classifySkuToChannel`) y compuerta estricta DGMN (Ley N° 17.798).
 */

import {
    CanonicalSupplySku,
    ProcurementBucket,
    SupplyCategoryCode,
    SupplyCostCenter,
    SupplyMemberProfile,
    SupplyOperationalRole,
    SupplyWarehouseClass,
    SupplyWhatsAppChannelId,
} from '../domain/types';

export function normalizeCatalogText(input: string): string {
    return String(input || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s./-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export const LEGACY_SKU_ID_ALIAS_MAP: Readonly<Record<string, string>> = {
    'sku-papas': 'SKU-VIV-PAPAS',
    'sku-papa-saco': 'SKU-VIV-PAPAS',
    'sku-cebollas': 'SKU-VIV-CEBOLLAS',
    'sku-tomates': 'SKU-VIV-TOMATES',
    'sku-verduras': 'SKU-VIV-VERDURAS',
    'sku-mantequilla': 'SKU-SUP-MANTEQUILLA',
    'sku-huevos': 'SKU-SUP-HUEVOS',
    'sku-pan': 'SKU-SUP-PAN',
    'sku-tallarines': 'SKU-SUP-TALLARINES',
    'sku-arroz': 'SKU-SUP-ARROZ',
    'sku-arroz-grano': 'SKU-SUP-ARROZ',
    'sku-aceite': 'SKU-SUP-ACEITE',
    'sku-carne': 'SKU-SUP-CARNE',
    'sku-cloro': 'SKU-ASEO-CLORO',
    'sku-alcohol-gel': 'SKU-ASEO-ALCOHOL-GEL',
    'sku-agua-bidon': 'SKU-AGUA-BIDON',
    'sku-agua-bidon-20l': 'SKU-AGUA-BIDON',
    'sku-agua-20l': 'SKU-AGUA-BIDON',
    'sku-gas-glp': 'SKU-GAS-GLP45',
    'sku-gas-glp45': 'SKU-GAS-GLP45',
    'sku-gas-glp15': 'SKU-GAS-GLP15',
    'sku-diesel': 'SKU-COMB-DIESEL',
    'sku-pernos': 'SKU-FER-PERNOS',
    'sku-cemento': 'SKU-FER-CEMENTO',
    'sku-disco-corte': 'SKU-FER-DISCO-CORTE',
    'sku-clavos': 'SKU-FER-CLAVOS',
    'sku-filtro-hidraulico': 'SKU-OPM-FILTRO-ACEITE',
    'sku-filter-cat': 'SKU-OPM-FILTRO-ACEITE',
    'sku-filtro-aceite': 'SKU-OPM-FILTRO-ACEITE',
    'sku-aceite-15w40': 'SKU-OPM-ACEITE-15W40',
    'sku-manguera-hidraulica': 'SKU-OPM-MANGUERA-HID',
    'sku-broca-perforacion': 'SKU-OPM-BROCA-PERF',
    'sku-epp-bototos': 'SKU-EPP-BOTOTOS',
    'sku-epp-guantes': 'SKU-EPP-GUANTES',
    'sku-epp-casco': 'SKU-EPP-CASCO',
    'sku-mantencion-camp': 'SKU-MANT-REPARACION',
    'sku-cocina-industrial': 'SKU-CAPEX-COCINA',
    'sku-generador': 'SKU-CAPEX-GENERADOR',
    'sku-refrigerador': 'SKU-CAPEX-REFRIGERADOR',
    'sku-detonador': 'SKU-EXP-DETONADOR',
};

export function resolveCanonicalSkuIdAlias(rawSkuId: string): string {
    const trimmed = String(rawSkuId || '').trim();
    if (!trimmed) return trimmed;
    const lower = trimmed.toLowerCase();
    return LEGACY_SKU_ID_ALIAS_MAP[lower] || trimmed;
}

export const CATEGORY_DEFAULT_COST_CENTER: Record<SupplyCategoryCode, SupplyCostCenter> = {
    VIVERES_ALIMENTACION: 'CC-CAMP-ALIMENTACION',
    AGUA_POTABLE_BEBESTIBLE: 'CC-CAMP-AGUA',
    AGUA_POTABLE_SANITAR: 'CC-CAMP-AGUA',
    AGUA_INDUSTRIAL: 'CC-OPS-AGUA-IND',
    GAS_DOMESTICO_GLP: 'CC-CAMP-ENERGIA',
    GASES_INDUSTRIALES: 'CC-FLOTA-MANTENCION',
    COMBUSTIBLE_CAMPAMENTO: 'CC-CAMP-ENERGIA',
    COMBUSTIBLE_FLOTA_PROD: 'CC-FLOTA-COMBUSTIBLE',
    REPUESTOS_MAQUINARIA: 'CC-FLOTA-MANTENCION',
    LUBRICANTES_FILTROS: 'CC-FLOTA-MANTENCION',
    FERRETERIA_CONSTRUCCION: 'CC-OPS-MINA',
    HERRAMIENTAS: 'CC-OPS-MINA',
    PERFORACION_ACEROS: 'CC-OPS-MINA',
    FORTIFICACION: 'CC-OPS-MINA',
    EXPLOSIVOS_REGULADO: 'CC-OPS-TRONADURA',
    QUIMICOS_REGULADOS: 'CC-OPS-TRONADURA',
    ACTIVO_EQUIPAMIENTO: 'CC-CAPEX',
    ASEO_HIGIENE: 'CC-CAMP-MANTENCION',
    MANTENCION_CAMP: 'CC-CAMP-MANTENCION',
    EPP_SEGURIDAD: 'CC-HSEC',
    OTROS_OPERACIONAL: 'CC-OPS-MINA',
};

export interface SupplyChannelMeta {
    channelId: SupplyWhatsAppChannelId;
    domain: 'CAMPAMENTO' | 'OPERACION' | 'CONTROLADO' | 'PATRIMONIO' | 'LOGISTICA' | 'FINANZAS';
    labelEs: string;
    categories: readonly SupplyCategoryCode[];
    buckets: readonly ProcurementBucket[];
    defaultCostCenter: SupplyCostCenter;
    defaultWarehouseClasses: readonly SupplyWarehouseClass[];
    normativeRefs: readonly string[];
    requiresDgmnLicense?: boolean;
}

export const SUPPLY_CHANNELS_META: Readonly<Record<SupplyWhatsAppChannelId, SupplyChannelMeta>> = {
    CH_CAMP_FOOD: {
        channelId: 'CH_CAMP_FOOD',
        domain: 'CAMPAMENTO',
        labelEs: 'Alimentación y Víveres',
        categories: ['VIVERES_ALIMENTACION'],
        buckets: ['VERDULERIA', 'SUPERMERCADO'],
        defaultCostCenter: 'CC-CAMP-ALIMENTACION',
        defaultWarehouseClasses: ['DRY_WAREHOUSE', 'COLD_STORAGE'],
        normativeRefs: ['DS 594', 'RSA DS 977', 'Ley 20.949'],
    },
    CH_CAMP_POTABLE_WATER: {
        channelId: 'CH_CAMP_POTABLE_WATER',
        domain: 'CAMPAMENTO',
        labelEs: 'Agua Potable Humana',
        categories: ['AGUA_POTABLE_BEBESTIBLE', 'AGUA_POTABLE_SANITAR'],
        buckets: ['AGUA_POTABLE'],
        defaultCostCenter: 'CC-CAMP-AGUA',
        defaultWarehouseClasses: ['POTABLE_WATER_TANK', 'DRY_WAREHOUSE'],
        normativeRefs: ['DS 594 Art. 14', 'DS 28 Altitud', 'NCh 409'],
    },
    CH_CAMP_GLP_GAS: {
        channelId: 'CH_CAMP_GLP_GAS',
        domain: 'CAMPAMENTO',
        labelEs: 'Gas Doméstico GLP',
        categories: ['GAS_DOMESTICO_GLP'],
        buckets: ['GAS_GLP_DOMESTICO'],
        defaultCostCenter: 'CC-CAMP-ENERGIA',
        defaultWarehouseClasses: ['GLP_CAGE'],
        normativeRefs: ['SEC DS 108', 'DS 29'],
    },
    CH_CAMP_FUEL: {
        channelId: 'CH_CAMP_FUEL',
        domain: 'CAMPAMENTO',
        labelEs: 'Combustible Campamento',
        categories: ['COMBUSTIBLE_CAMPAMENTO'],
        buckets: ['COMBUSTIBLE_GRANEL'],
        defaultCostCenter: 'CC-CAMP-ENERGIA',
        defaultWarehouseClasses: ['FUEL_TANK_CAMP'],
        normativeRefs: ['SEC DS 160'],
    },
    CH_CAMP_HYGIENE_MAINT: {
        channelId: 'CH_CAMP_HYGIENE_MAINT',
        domain: 'CAMPAMENTO',
        labelEs: 'Mantención y Aseo Campamento',
        categories: ['ASEO_HIGIENE', 'MANTENCION_CAMP'],
        buckets: ['ASEO_HIGIENE', 'MANTENCION_CAMP'],
        defaultCostCenter: 'CC-CAMP-MANTENCION',
        defaultWarehouseClasses: ['DRY_WAREHOUSE'],
        normativeRefs: ['DS 594 Habitabilidad'],
    },
    CH_OPS_IND_WATER: {
        channelId: 'CH_OPS_IND_WATER',
        domain: 'OPERACION',
        labelEs: 'Agua Industrial',
        categories: ['AGUA_INDUSTRIAL'],
        buckets: ['AGUA_INDUSTRIAL_ALJIBE'],
        defaultCostCenter: 'CC-OPS-AGUA-IND',
        defaultWarehouseClasses: ['INDUSTRIAL_WATER_POND'],
        normativeRefs: ['DGA', 'RCA', 'DS 132'],
    },
    CH_OPS_FLEET_FUEL: {
        channelId: 'CH_OPS_FLEET_FUEL',
        domain: 'OPERACION',
        labelEs: 'Combustible Producción y Flota',
        categories: ['COMBUSTIBLE_FLOTA_PROD'],
        buckets: ['COMBUSTIBLE_GRANEL'],
        defaultCostCenter: 'CC-FLOTA-COMBUSTIBLE',
        defaultWarehouseClasses: ['FUEL_TANK_FLEET'],
        normativeRefs: ['SEC DS 160', 'DS 132', 'OPERMAQ'],
    },
    CH_OPS_IND_GASES: {
        channelId: 'CH_OPS_IND_GASES',
        domain: 'OPERACION',
        labelEs: 'Gases Industriales',
        categories: ['GASES_INDUSTRIALES'],
        buckets: ['GASES_INDUSTRIALES'],
        defaultCostCenter: 'CC-FLOTA-MANTENCION',
        defaultWarehouseClasses: ['INDUSTRIAL_GAS_CAGE'],
        normativeRefs: ['DS 43 MINSAL', 'NCh 2190'],
    },
    CH_OPS_PARTS_LUBES: {
        channelId: 'CH_OPS_PARTS_LUBES',
        domain: 'OPERACION',
        labelEs: 'Repuestos, Lubricantes y Filtros',
        categories: ['REPUESTOS_MAQUINARIA', 'LUBRICANTES_FILTROS'],
        buckets: ['REPUESTOS_LUBRICANTES'],
        defaultCostCenter: 'CC-FLOTA-MANTENCION',
        defaultWarehouseClasses: ['DRY_WAREHOUSE', 'HAZMAT_DS43'],
        normativeRefs: ['DS 148 RESPEL', 'OPERMAQ'],
    },
    CH_OPS_HARDWARE_DRILL: {
        channelId: 'CH_OPS_HARDWARE_DRILL',
        domain: 'OPERACION',
        labelEs: 'Ferretería, Perforación y Fortificación',
        categories: [
            'FERRETERIA_CONSTRUCCION',
            'HERRAMIENTAS',
            'PERFORACION_ACEROS',
            'FORTIFICACION',
            'OTROS_OPERACIONAL',
        ],
        buckets: ['FERRETERIA_INSUMOS', 'PERFORACION_FORTIFICACION'],
        defaultCostCenter: 'CC-OPS-MINA',
        defaultWarehouseClasses: ['DRY_WAREHOUSE'],
        normativeRefs: ['DS 132', 'Ley 20.949'],
    },
    CH_HSEC_EPP: {
        channelId: 'CH_HSEC_EPP',
        domain: 'OPERACION',
        labelEs: 'EPP y Seguridad HSEC',
        categories: ['EPP_SEGURIDAD'],
        buckets: ['EPP_SEGURIDAD'],
        defaultCostCenter: 'CC-HSEC',
        defaultWarehouseClasses: ['DRY_WAREHOUSE'],
        normativeRefs: ['DS 594', 'DS 132', 'ISP/CESMEC'],
    },
    CH_CONTROLLED_DGMN: {
        channelId: 'CH_CONTROLLED_DGMN',
        domain: 'CONTROLADO',
        labelEs: 'Explosivos y Sustancias Controladas',
        categories: ['EXPLOSIVOS_REGULADO', 'QUIMICOS_REGULADOS'],
        buckets: ['CONTROLADOS_DGMN'],
        defaultCostCenter: 'CC-OPS-TRONADURA',
        defaultWarehouseClasses: ['MAGAZINE_DGMN', 'HAZMAT_DS43'],
        normativeRefs: ['Ley N° 17.798 DGMN', 'DS 43'],
        requiresDgmnLicense: true,
    },
    CH_CAPEX_ASSETS: {
        channelId: 'CH_CAPEX_ASSETS',
        domain: 'PATRIMONIO',
        labelEs: 'Activos Fijos y Equipamiento CAPEX',
        categories: ['ACTIVO_EQUIPAMIENTO'],
        buckets: ['ACTIVOS_CAPEX'],
        defaultCostCenter: 'CC-CAPEX',
        defaultWarehouseClasses: ['VIRTUAL_IN_TRANSIT'],
        normativeRefs: ['Art. 31 N° 5 LIR', 'DTE 33/34'],
    },
    CH_WAREHOUSE_RECEPTION: {
        channelId: 'CH_WAREHOUSE_RECEPTION',
        domain: 'LOGISTICA',
        labelEs: 'Recepción Física, Salidas y Aforos',
        categories: [],
        buckets: [],
        defaultCostCenter: 'CC-OPS-MINA',
        defaultWarehouseClasses: ['DRY_WAREHOUSE', 'POTABLE_WATER_TANK', 'FUEL_TANK_FLEET'],
        normativeRefs: ['Kardex', 'HITL Recepción'],
    },
    CH_DIRECT_PURCHASE_EXEC: {
        channelId: 'CH_DIRECT_PURCHASE_EXEC',
        domain: 'FINANZAS',
        labelEs: 'Compras Directas, Boletas DTE y Rendición',
        categories: [],
        buckets: [],
        defaultCostCenter: 'CC-OPS-MINA',
        defaultWarehouseClasses: ['VIRTUAL_IN_TRANSIT'],
        normativeRefs: ['SII DL 825', 'Ley 19.983 RCV 8d'],
    },
};

export function getChannelsForProfileRole(
    role: SupplyOperationalRole,
    options?: { licensedForControlledItems?: boolean }
): SupplyWhatsAppChannelId[] {
    const hasDgmn = Boolean(options?.licensedForControlledItems);
    switch (role) {
        case 'CAMP_MANAGER':
            return [
                'CH_CAMP_FOOD',
                'CH_CAMP_POTABLE_WATER',
                'CH_CAMP_GLP_GAS',
                'CH_CAMP_FUEL',
                'CH_CAMP_HYGIENE_MAINT',
            ];
        case 'MECHANIC_TECH':
            return [
                'CH_OPS_PARTS_LUBES',
                'CH_OPS_FLEET_FUEL',
                'CH_OPS_IND_GASES',
                'CH_OPS_HARDWARE_DRILL',
                'CH_HSEC_EPP',
            ];
        case 'OPS_FOREMAN':
            return [
                'CH_OPS_HARDWARE_DRILL',
                'CH_OPS_IND_WATER',
                'CH_OPS_FLEET_FUEL',
                'CH_HSEC_EPP',
            ];
        case 'WAREHOUSE_KEEPER':
            return [
                'CH_WAREHOUSE_RECEPTION',
                'CH_CAMP_FOOD',
                'CH_CAMP_POTABLE_WATER',
                'CH_CAMP_GLP_GAS',
                'CH_CAMP_FUEL',
                'CH_CAMP_HYGIENE_MAINT',
                'CH_OPS_IND_WATER',
                'CH_OPS_FLEET_FUEL',
                'CH_OPS_IND_GASES',
                'CH_OPS_PARTS_LUBES',
                'CH_OPS_HARDWARE_DRILL',
                'CH_HSEC_EPP',
            ];
        case 'HSEC_OFFICER':
            return ['CH_HSEC_EPP', 'CH_CAMP_POTABLE_WATER', 'CH_CAMP_HYGIENE_MAINT'];
        case 'BUYER':
        case 'SITE_ADMIN':
            return [
                'CH_CAMP_FOOD',
                'CH_CAMP_POTABLE_WATER',
                'CH_CAMP_GLP_GAS',
                'CH_CAMP_FUEL',
                'CH_CAMP_HYGIENE_MAINT',
                'CH_OPS_IND_WATER',
                'CH_OPS_FLEET_FUEL',
                'CH_OPS_IND_GASES',
                'CH_OPS_PARTS_LUBES',
                'CH_OPS_HARDWARE_DRILL',
                'CH_HSEC_EPP',
                'CH_CAPEX_ASSETS',
                'CH_WAREHOUSE_RECEPTION',
                'CH_DIRECT_PURCHASE_EXEC',
            ];
        case 'OWNER_EXEC': {
            const base: SupplyWhatsAppChannelId[] = [
                'CH_CAMP_FOOD',
                'CH_CAMP_POTABLE_WATER',
                'CH_CAMP_GLP_GAS',
                'CH_CAMP_FUEL',
                'CH_CAMP_HYGIENE_MAINT',
                'CH_OPS_IND_WATER',
                'CH_OPS_FLEET_FUEL',
                'CH_OPS_IND_GASES',
                'CH_OPS_PARTS_LUBES',
                'CH_OPS_HARDWARE_DRILL',
                'CH_HSEC_EPP',
                'CH_CAPEX_ASSETS',
                'CH_WAREHOUSE_RECEPTION',
                'CH_DIRECT_PURCHASE_EXEC',
            ];
            if (hasDgmn) base.push('CH_CONTROLLED_DGMN');
            return base;
        }
    }
}

export function classifySkuToChannel(input: {
    categoryCode: SupplyCategoryCode;
    procurementBucket?: ProcurementBucket;
    isCapexAsset?: boolean;
    isControlled?: boolean;
}): SupplyWhatsAppChannelId {
    if (
        input.isControlled ||
        input.categoryCode === 'EXPLOSIVOS_REGULADO' ||
        input.categoryCode === 'QUIMICOS_REGULADOS' ||
        input.procurementBucket === 'CONTROLADOS_DGMN'
    ) {
        return 'CH_CONTROLLED_DGMN';
    }
    if (
        input.isCapexAsset ||
        input.categoryCode === 'ACTIVO_EQUIPAMIENTO' ||
        input.procurementBucket === 'ACTIVOS_CAPEX'
    ) {
        return 'CH_CAPEX_ASSETS';
    }
    switch (input.categoryCode) {
        case 'VIVERES_ALIMENTACION':
            return 'CH_CAMP_FOOD';
        case 'AGUA_POTABLE_BEBESTIBLE':
        case 'AGUA_POTABLE_SANITAR':
            return 'CH_CAMP_POTABLE_WATER';
        case 'AGUA_INDUSTRIAL':
            return 'CH_OPS_IND_WATER';
        case 'GAS_DOMESTICO_GLP':
            return 'CH_CAMP_GLP_GAS';
        case 'GASES_INDUSTRIALES':
            return 'CH_OPS_IND_GASES';
        case 'COMBUSTIBLE_CAMPAMENTO':
            return 'CH_CAMP_FUEL';
        case 'COMBUSTIBLE_FLOTA_PROD':
            return 'CH_OPS_FLEET_FUEL';
        case 'ASEO_HIGIENE':
        case 'MANTENCION_CAMP':
            return 'CH_CAMP_HYGIENE_MAINT';
        case 'REPUESTOS_MAQUINARIA':
        case 'LUBRICANTES_FILTROS':
            return 'CH_OPS_PARTS_LUBES';
        case 'EPP_SEGURIDAD':
            return 'CH_HSEC_EPP';
        case 'FERRETERIA_CONSTRUCCION':
        case 'HERRAMIENTAS':
        case 'PERFORACION_ACEROS':
        case 'FORTIFICACION':
        case 'OTROS_OPERACIONAL':
        default:
            return 'CH_OPS_HARDWARE_DRILL';
    }
}

export const DEFAULT_SUPPLY_CATALOG_SEED: readonly CanonicalSupplySku[] = [
    // ── VERDULERÍA ──────────────────────────────────────────────────────────
    {
        canonicalSkuId: 'SKU-VIV-PAPAS',
        name: 'Papas',
        aliases: ['papa', 'papas', 'malla de papas', 'malla papas', 'saco de papas', 'papa corriente'],
        categoryCode: 'VIVERES_ALIMENTACION',
        procurementBucket: 'VERDULERIA',
        baseUnitSi: 'kg',
        unspscCode: '50405600',
        requiredSlots: ['quantity'],
        defaultPackToSi: { packLabel: 'malla', factorToSi: 25, unitSi: 'kg' },
        referenceUnitPriceClp: 1100,
        isCapexAsset: false,
        isControlled: false,
        leySaco25kgApplied: true,
        slotQuestionTemplate: '¿Cuántos kilos o mallas (25 kg) de papas?',
        expectedDailyPerPaxSi: 0.35,
        defaultCostCenter: 'CC-CAMP-ALIMENTACION',
    },
    {
        canonicalSkuId: 'SKU-VIV-CEBOLLAS',
        name: 'Cebollas',
        aliases: ['cebolla', 'cebollas', 'malla de cebollas', 'malla cebollas'],
        categoryCode: 'VIVERES_ALIMENTACION',
        procurementBucket: 'VERDULERIA',
        baseUnitSi: 'kg',
        unspscCode: '50405300',
        requiredSlots: ['quantity'],
        defaultPackToSi: { packLabel: 'malla', factorToSi: 25, unitSi: 'kg' },
        referenceUnitPriceClp: 950,
        isCapexAsset: false,
        isControlled: false,
        leySaco25kgApplied: true,
        slotQuestionTemplate: '¿Cuántos kilos o mallas (25 kg) de cebollas?',
        expectedDailyPerPaxSi: 0.12,
        defaultCostCenter: 'CC-CAMP-ALIMENTACION',
    },
    {
        canonicalSkuId: 'SKU-VIV-TOMATES',
        name: 'Tomates',
        aliases: ['tomate', 'tomates', 'caja de tomates'],
        categoryCode: 'VIVERES_ALIMENTACION',
        procurementBucket: 'VERDULERIA',
        baseUnitSi: 'kg',
        unspscCode: '50406500',
        requiredSlots: ['quantity'],
        defaultPackToSi: { packLabel: 'caja', factorToSi: 18, unitSi: 'kg' },
        referenceUnitPriceClp: 1600,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos kilos o cajas de tomates?',
        expectedDailyPerPaxSi: 0.15,
        defaultCostCenter: 'CC-CAMP-ALIMENTACION',
    },
    {
        canonicalSkuId: 'SKU-VIV-VERDURAS',
        name: 'Verduras surtidas',
        aliases: ['verdura', 'verduras', 'lechuga', 'zanahoria', 'zanahorias', 'zapallo', 'repollo'],
        categoryCode: 'VIVERES_ALIMENTACION',
        procurementBucket: 'VERDULERIA',
        baseUnitSi: 'kg',
        unspscCode: '50400000',
        requiredSlots: ['quantity'],
        referenceUnitPriceClp: 1500,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos kilos de verduras?',
        expectedDailyPerPaxSi: 0.25,
        defaultCostCenter: 'CC-CAMP-ALIMENTACION',
    },

    // ── SUPERMERCADO ────────────────────────────────────────────────────────
    {
        canonicalSkuId: 'SKU-SUP-MANTEQUILLA',
        name: 'Mantequilla',
        aliases: ['mantequilla', 'mantequillas', 'pote de mantequilla', 'pan de mantequilla', 'margarina'],
        categoryCode: 'VIVERES_ALIMENTACION',
        procurementBucket: 'SUPERMERCADO',
        baseUnitSi: 'kg',
        unspscCode: '50131701',
        requiredSlots: ['quantity', 'packagingUnit'],
        defaultPackToSi: { packLabel: 'pote', factorToSi: 0.25, unitSi: 'kg' },
        referenceUnitPriceClp: 9600,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos potes o panes de mantequilla?',
        expectedDailyPerPaxSi: 0.025,
        defaultCostCenter: 'CC-CAMP-ALIMENTACION',
    },
    {
        canonicalSkuId: 'SKU-SUP-HUEVOS',
        name: 'Huevos',
        aliases: ['huevo', 'huevos', 'bandeja de huevos', 'bandejas de huevos', 'carton de huevos'],
        categoryCode: 'VIVERES_ALIMENTACION',
        procurementBucket: 'SUPERMERCADO',
        baseUnitSi: 'un',
        unspscCode: '50131600',
        requiredSlots: ['quantity'],
        defaultPackToSi: { packLabel: 'bandeja', factorToSi: 30, unitSi: 'un' },
        referenceUnitPriceClp: 260,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántas bandejas (30 un) o cuántos huevos?',
        expectedDailyPerPaxSi: 2,
        defaultCostCenter: 'CC-CAMP-ALIMENTACION',
    },
    {
        canonicalSkuId: 'SKU-SUP-PAN',
        name: 'Pan',
        aliases: ['pan', 'marraqueta', 'hallulla', 'pan amasado', 'pan corriente'],
        categoryCode: 'VIVERES_ALIMENTACION',
        procurementBucket: 'SUPERMERCADO',
        baseUnitSi: 'kg',
        unspscCode: '50181900',
        requiredSlots: ['quantity'],
        referenceUnitPriceClp: 2200,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos kilos de pan?',
        expectedDailyPerPaxSi: 0.25,
        defaultCostCenter: 'CC-CAMP-ALIMENTACION',
    },
    {
        canonicalSkuId: 'SKU-SUP-TALLARINES',
        name: 'Tallarines',
        aliases: ['tallarin', 'tallarines', 'fideos', 'espagueti', 'pasta', 'paquete de tallarines'],
        categoryCode: 'VIVERES_ALIMENTACION',
        procurementBucket: 'SUPERMERCADO',
        baseUnitSi: 'kg',
        unspscCode: '50192900',
        requiredSlots: ['quantity'],
        defaultPackToSi: { packLabel: 'paquete', factorToSi: 0.4, unitSi: 'kg' },
        referenceUnitPriceClp: 2800,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos paquetes (400 g) o kilos de tallarines?',
        expectedDailyPerPaxSi: 0.1,
        defaultCostCenter: 'CC-CAMP-ALIMENTACION',
    },
    {
        canonicalSkuId: 'SKU-SUP-ARROZ',
        name: 'Arroz',
        aliases: ['arroz', 'paquete de arroz', 'arroz grado 1'],
        categoryCode: 'VIVERES_ALIMENTACION',
        procurementBucket: 'SUPERMERCADO',
        baseUnitSi: 'kg',
        unspscCode: '50221101',
        requiredSlots: ['quantity'],
        defaultPackToSi: { packLabel: 'paquete', factorToSi: 1, unitSi: 'kg' },
        referenceUnitPriceClp: 1650,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos kilos de arroz?',
        expectedDailyPerPaxSi: 0.12,
        defaultCostCenter: 'CC-CAMP-ALIMENTACION',
    },
    {
        canonicalSkuId: 'SKU-SUP-ACEITE',
        name: 'Aceite vegetal',
        aliases: ['aceite', 'aceite vegetal', 'aceite cocina', 'aceite maravilla'],
        categoryCode: 'VIVERES_ALIMENTACION',
        procurementBucket: 'SUPERMERCADO',
        baseUnitSi: 'L',
        unspscCode: '50151500',
        requiredSlots: ['quantity'],
        defaultPackToSi: { packLabel: 'botella', factorToSi: 1, unitSi: 'L' },
        referenceUnitPriceClp: 2400,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos litros de aceite vegetal?',
        expectedDailyPerPaxSi: 0.05,
        defaultCostCenter: 'CC-CAMP-ALIMENTACION',
    },
    {
        canonicalSkuId: 'SKU-SUP-CARNE',
        name: 'Carne / Proteína',
        aliases: ['carne', 'pollo', 'vacuno', 'posta', 'bistec', 'cerdo'],
        categoryCode: 'VIVERES_ALIMENTACION',
        procurementBucket: 'SUPERMERCADO',
        baseUnitSi: 'kg',
        unspscCode: '50111500',
        requiredSlots: ['quantity'],
        referenceUnitPriceClp: 8500,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos kilos de carne o proteína?',
        expectedDailyPerPaxSi: 0.3,
        defaultCostCenter: 'CC-CAMP-ALIMENTACION',
    },

    // ── ASEO E HIGIENE CAMPAMENTO ───────────────────────────────────────────
    {
        canonicalSkuId: 'SKU-ASEO-CLORO',
        name: 'Cloro líquido',
        aliases: ['cloro', 'cloro liquido', 'bidon de cloro', 'bidon cloro', 'hipoclorito', 'desinfectante'],
        categoryCode: 'ASEO_HIGIENE',
        procurementBucket: 'ASEO_HIGIENE',
        baseUnitSi: 'L',
        unspscCode: '47131807',
        requiredSlots: ['quantity'],
        defaultPackToSi: { packLabel: 'bidon', factorToSi: 5, unitSi: 'L' },
        referenceUnitPriceClp: 950,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos litros o bidones (5 L) de cloro?',
        expectedDailyPerPaxSi: 0.05,
        defaultCostCenter: 'CC-CAMP-MANTENCION',
    },
    {
        canonicalSkuId: 'SKU-ASEO-ALCOHOL-GEL',
        name: 'Alcohol gel higienizante',
        aliases: ['alcohol gel', 'alcohol isopropilico', 'alcohol desinfectante', 'alcohol medicinal'],
        categoryCode: 'ASEO_HIGIENE',
        procurementBucket: 'ASEO_HIGIENE',
        baseUnitSi: 'L',
        unspscCode: '53131626',
        requiredSlots: ['quantity'],
        defaultPackToSi: { packLabel: 'botella', factorToSi: 1, unitSi: 'L' },
        referenceUnitPriceClp: 3500,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos litros de alcohol gel?',
        defaultCostCenter: 'CC-HSEC',
    },

    // ── AGUA POTABLE HUMANA (DS 594) VS AGUA INDUSTRIAL ──────────────────────
    {
        canonicalSkuId: 'SKU-AGUA-BIDON',
        name: 'Agua potable en bidón',
        aliases: ['agua potable', 'agua purificada', 'agua bebestible', 'bidon de agua', 'bidon 20l', 'botellon de agua'],
        categoryCode: 'AGUA_POTABLE_BEBESTIBLE',
        procurementBucket: 'AGUA_POTABLE',
        baseUnitSi: 'L',
        unspscCode: '50202301',
        requiredSlots: ['quantity'],
        defaultPackToSi: { packLabel: 'bidon', factorToSi: 20, unitSi: 'L' },
        referenceUnitPriceClp: 150,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos bidones (20 L) o litros de agua potable?',
        expectedDailyPerPaxSi: 120,
        defaultCostCenter: 'CC-CAMP-AGUA',
    },
    {
        canonicalSkuId: 'SKU-AGUA-POTABLE-CAMION',
        name: 'Agua potable sanitaria aljibe',
        aliases: ['agua potable sanitaria', 'agua sanitaria campamento', 'aljibe potable', 'agua estanque potable'],
        categoryCode: 'AGUA_POTABLE_SANITAR',
        procurementBucket: 'AGUA_POTABLE',
        baseUnitSi: 'L',
        unspscCode: '10171600',
        requiredSlots: ['quantity'],
        defaultPackToSi: { packLabel: 'm3', factorToSi: 1000, unitSi: 'L' },
        referenceUnitPriceClp: 25,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos litros o m3 de agua potable sanitaria?',
        expectedDailyPerPaxSi: 120,
        defaultCostCenter: 'CC-CAMP-AGUA',
    },
    {
        canonicalSkuId: 'SKU-AGUA-INDUSTRIAL',
        name: 'Agua industrial perforación / riego / planta',
        aliases: ['agua industrial', 'agua perforacion', 'agua de riego', 'agua chancado', 'agua planta', 'agua supresion polvo'],
        categoryCode: 'AGUA_INDUSTRIAL',
        procurementBucket: 'AGUA_INDUSTRIAL_ALJIBE',
        baseUnitSi: 'm3',
        unspscCode: '10171601',
        requiredSlots: ['quantity'],
        referenceUnitPriceClp: 8500,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos m3 de agua industrial necesitas?',
        defaultCostCenter: 'CC-OPS-AGUA-IND',
    },

    // ── GAS DOMÉSTICO GLP VS GASES INDUSTRIALES ──────────────────────────────
    {
        canonicalSkuId: 'SKU-GAS-GLP45',
        name: 'Gas licuado GLP 45 kg',
        aliases: ['balon de 45', 'balon 45', 'cilindro de 45', 'gas de 45', 'glp 45', 'gas 45', 'gas licuado', 'gas glp'],
        categoryCode: 'GAS_DOMESTICO_GLP',
        procurementBucket: 'GAS_GLP_DOMESTICO',
        baseUnitSi: 'kg',
        unspscCode: '15111510',
        requiredSlots: ['quantity'],
        defaultPackToSi: { packLabel: 'balon de 45', factorToSi: 45, unitSi: 'kg' },
        referenceUnitPriceClp: 1950,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos balones de gas GLP de 45 kg?',
        expectedDailyPerPaxSi: 0.4,
        defaultCostCenter: 'CC-CAMP-ENERGIA',
    },
    {
        canonicalSkuId: 'SKU-GAS-GLP15',
        name: 'Gas licuado GLP 15 kg',
        aliases: ['balon de 15', 'balon 15', 'cilindro de 15', 'gas de 15', 'glp 15', 'gas 15'],
        categoryCode: 'GAS_DOMESTICO_GLP',
        procurementBucket: 'GAS_GLP_DOMESTICO',
        baseUnitSi: 'kg',
        unspscCode: '15111510',
        requiredSlots: ['quantity'],
        defaultPackToSi: { packLabel: 'balon de 15', factorToSi: 15, unitSi: 'kg' },
        referenceUnitPriceClp: 1850,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos balones de gas GLP de 15 kg?',
        expectedDailyPerPaxSi: 0.25,
        defaultCostCenter: 'CC-CAMP-ENERGIA',
    },
    {
        canonicalSkuId: 'SKU-GAS-OXIGENO',
        name: 'Oxígeno industrial cilindro',
        aliases: ['oxigeno', 'cilindro de oxigeno', 'oxigeno industrial', 'gas oxigeno', 'oxicorte'],
        categoryCode: 'GASES_INDUSTRIALES',
        procurementBucket: 'GASES_INDUSTRIALES',
        baseUnitSi: 'm3',
        unspscCode: '12141904',
        requiredSlots: ['quantity'],
        defaultPackToSi: { packLabel: 'cilindro', factorToSi: 10, unitSi: 'm3' },
        referenceUnitPriceClp: 9500,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos m3 o cilindros de oxígeno industrial?',
        defaultCostCenter: 'CC-FLOTA-MANTENCION',
    },
    {
        canonicalSkuId: 'SKU-GAS-ACETILENO',
        name: 'Acetileno / Argón soldadura',
        aliases: ['acetileno', 'argon', 'gas argon', 'cilindro acetileno', 'gas soldadura'],
        categoryCode: 'GASES_INDUSTRIALES',
        procurementBucket: 'GASES_INDUSTRIALES',
        baseUnitSi: 'm3',
        unspscCode: '12141901',
        requiredSlots: ['quantity'],
        defaultPackToSi: { packLabel: 'cilindro', factorToSi: 6, unitSi: 'm3' },
        referenceUnitPriceClp: 14500,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos m3 o cilindros de acetileno/argón?',
        defaultCostCenter: 'CC-FLOTA-MANTENCION',
    },

    // ── COMBUSTIBLE CAMPAMENTO VS FLOTA / PRODUCCIÓN ─────────────────────────
    {
        canonicalSkuId: 'SKU-COMB-DIESEL-CAMP',
        name: 'Diésel / Parafina generador campamento',
        aliases: ['diesel campamento', 'diesel generador', 'petroleo campamento', 'parafina', 'kerosene campamento'],
        categoryCode: 'COMBUSTIBLE_CAMPAMENTO',
        procurementBucket: 'COMBUSTIBLE_GRANEL',
        baseUnitSi: 'L',
        unspscCode: '15101505',
        requiredSlots: ['quantity'],
        defaultPackToSi: { packLabel: 'tambor', factorToSi: 200, unitSi: 'L' },
        referenceUnitPriceClp: 1080,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos litros o tambores (200 L) de combustible para campamento?',
        defaultCostCenter: 'CC-CAMP-ENERGIA',
    },
    {
        canonicalSkuId: 'SKU-COMB-DIESEL',
        name: 'Petróleo Diésel flota / producción',
        aliases: ['diesel', 'petroleo', 'petroleo diesel', 'combustible diesel', 'diesel flota', 'tambor diesel'],
        categoryCode: 'COMBUSTIBLE_FLOTA_PROD',
        procurementBucket: 'COMBUSTIBLE_GRANEL',
        baseUnitSi: 'L',
        unspscCode: '15101505',
        requiredSlots: ['quantity'],
        defaultPackToSi: { packLabel: 'tambor', factorToSi: 200, unitSi: 'L' },
        referenceUnitPriceClp: 1080,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos litros o tambores (200 L) de diésel flota?',
        defaultCostCenter: 'CC-FLOTA-COMBUSTIBLE',
    },

    // ── FERRETERÍA, HERRAMIENTAS, PERFORACIÓN Y FORTIFICACIÓN ────────────────
    {
        canonicalSkuId: 'SKU-FER-PERNOS',
        name: 'Pernos',
        aliases: ['perno', 'pernos', 'pernos hexagonales', 'pernos de anclaje', 'perno anclaje'],
        categoryCode: 'FERRETERIA_CONSTRUCCION',
        procurementBucket: 'FERRETERIA_INSUMOS',
        baseUnitSi: 'un',
        unspscCode: '31161600',
        requiredSlots: ['quantity'],
        referenceUnitPriceClp: 650,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántas unidades de pernos necesitas?',
        defaultCostCenter: 'CC-OPS-MINA',
    },
    {
        canonicalSkuId: 'SKU-FER-CEMENTO',
        name: 'Cemento Portland',
        aliases: ['cemento', 'saco de cemento', 'sacos de cemento', 'cemento portland'],
        categoryCode: 'FERRETERIA_CONSTRUCCION',
        procurementBucket: 'FERRETERIA_INSUMOS',
        baseUnitSi: 'kg',
        unspscCode: '30111601',
        requiredSlots: ['quantity'],
        defaultPackToSi: { packLabel: 'saco', factorToSi: 25, unitSi: 'kg' },
        referenceUnitPriceClp: 220,
        isCapexAsset: false,
        isControlled: false,
        leySaco25kgApplied: true,
        slotQuestionTemplate: '¿Cuántos sacos (25 kg) o kilos de cemento?',
        defaultCostCenter: 'CC-OPS-MINA',
    },
    {
        canonicalSkuId: 'SKU-FER-DISCO-CORTE',
        name: 'Disco de corte metal',
        aliases: ['disco de corte', 'discos de corte', 'disco esmeril', 'disco corte metal'],
        categoryCode: 'HERRAMIENTAS',
        procurementBucket: 'FERRETERIA_INSUMOS',
        baseUnitSi: 'un',
        unspscCode: '31191506',
        requiredSlots: ['quantity'],
        referenceUnitPriceClp: 1950,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos discos de corte necesitas?',
        defaultCostCenter: 'CC-OPS-MINA',
    },
    {
        canonicalSkuId: 'SKU-FER-CLAVOS',
        name: 'Clavos corrientes',
        aliases: ['clavo', 'clavos', 'clavos corrientes'],
        categoryCode: 'FERRETERIA_CONSTRUCCION',
        procurementBucket: 'FERRETERIA_INSUMOS',
        baseUnitSi: 'kg',
        unspscCode: '31162000',
        requiredSlots: ['quantity'],
        referenceUnitPriceClp: 2900,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos kilos de clavos?',
        defaultCostCenter: 'CC-OPS-MINA',
    },
    {
        canonicalSkuId: 'SKU-OPM-BROCA-PERF',
        name: 'Broca perforación botones',
        aliases: ['broca', 'brocas', 'broca perforacion', 'bit perforacion', 'barra perforacion'],
        categoryCode: 'PERFORACION_ACEROS',
        procurementBucket: 'PERFORACION_FORTIFICACION',
        baseUnitSi: 'un',
        unspscCode: '20111600',
        requiredSlots: ['quantity', 'linkedAssetId'],
        referenceUnitPriceClp: 95000,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántas brocas de perforación y para qué perforadora?',
        defaultCostCenter: 'CC-OPS-MINA',
    },

    // ── REPUESTOS Y LUBRICANTES OPERMAQ ──────────────────────────────────────
    {
        canonicalSkuId: 'SKU-OPM-FILTRO-ACEITE',
        name: 'Filtro de aceite / hidráulico maquinaria',
        aliases: ['filtro de aceite', 'filtro aceite', 'filtros de aceite', 'filtro motor', 'filtro hidraulico'],
        categoryCode: 'LUBRICANTES_FILTROS',
        procurementBucket: 'REPUESTOS_LUBRICANTES',
        baseUnitSi: 'un',
        unspscCode: '40161504',
        requiredSlots: ['quantity', 'linkedAssetId'],
        referenceUnitPriceClp: 28000,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos filtros de aceite/hidráulico y para qué equipo (código máquina)?',
        defaultCostCenter: 'CC-FLOTA-MANTENCION',
    },
    {
        canonicalSkuId: 'SKU-OPM-ACEITE-15W40',
        name: 'Aceite motor 15W-40',
        aliases: ['aceite 15w40', 'aceite 15w-40', 'aceite motor', 'lubricante motor', 'balde aceite'],
        categoryCode: 'LUBRICANTES_FILTROS',
        procurementBucket: 'REPUESTOS_LUBRICANTES',
        baseUnitSi: 'L',
        unspscCode: '15121501',
        requiredSlots: ['quantity', 'linkedAssetId'],
        defaultPackToSi: { packLabel: 'balde 20L', factorToSi: 20, unitSi: 'L' },
        referenceUnitPriceClp: 4900,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos baldes (20 L) o litros de aceite 15W-40 y para qué equipo?',
        defaultCostCenter: 'CC-FLOTA-MANTENCION',
    },
    {
        canonicalSkuId: 'SKU-OPM-MANGUERA-HID',
        name: 'Manguera / Cilindro hidráulico alta presión',
        aliases: ['manguera hidraulica', 'manguera alta presion', 'latiguillo hidraulico', 'cilindro hidraulico', 'piston hidraulico'],
        categoryCode: 'REPUESTOS_MAQUINARIA',
        procurementBucket: 'REPUESTOS_LUBRICANTES',
        baseUnitSi: 'm',
        unspscCode: '40142008',
        requiredSlots: ['quantity', 'linkedAssetId'],
        referenceUnitPriceClp: 18500,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos metros/unidades y para qué máquina?',
        defaultCostCenter: 'CC-FLOTA-MANTENCION',
    },

    // ── EPP SEGURIDAD HSEC ──────────────────────────────────────────────────
    {
        canonicalSkuId: 'SKU-EPP-BOTOTOS',
        name: 'Bototos de seguridad',
        aliases: ['bototos', 'bototo', 'zapatos de seguridad', 'zapato de seguridad', 'botas de seguridad'],
        categoryCode: 'EPP_SEGURIDAD',
        procurementBucket: 'EPP_SEGURIDAD',
        baseUnitSi: 'par',
        unspscCode: '46181604',
        requiredSlots: ['quantity', 'size'],
        referenceUnitPriceClp: 54000,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos pares de bototos de seguridad y qué número/talla?',
        defaultCostCenter: 'CC-HSEC',
    },
    {
        canonicalSkuId: 'SKU-EPP-GUANTES',
        name: 'Guantes de seguridad',
        aliases: ['guantes', 'guante', 'guantes cabritilla', 'guantes anticorte', 'guantes de seguridad'],
        categoryCode: 'EPP_SEGURIDAD',
        procurementBucket: 'EPP_SEGURIDAD',
        baseUnitSi: 'par',
        unspscCode: '46181504',
        requiredSlots: ['quantity', 'size'],
        referenceUnitPriceClp: 5500,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos pares de guantes y en qué talla (S, M, L, XL)?',
        defaultCostCenter: 'CC-HSEC',
    },
    {
        canonicalSkuId: 'SKU-EPP-CASCO',
        name: 'Casco de seguridad minero',
        aliases: ['casco', 'cascos', 'casco minero', 'casco de seguridad'],
        categoryCode: 'EPP_SEGURIDAD',
        procurementBucket: 'EPP_SEGURIDAD',
        baseUnitSi: 'un',
        unspscCode: '46181701',
        requiredSlots: ['quantity'],
        referenceUnitPriceClp: 19500,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos cascos de seguridad necesitas?',
        defaultCostCenter: 'CC-HSEC',
    },

    // ── MANTENCIÓN CAMPAMENTO Y ACTIVOS CAPEX SEPARADOS ─────────────────────
    {
        canonicalSkuId: 'SKU-MANT-REPARACION',
        name: 'Reparación / Mantención campamento',
        aliases: ['reparacion', 'reparar', 'mantencion campamento', 'arreglo', 'fuga de agua', 'calefont roto'],
        categoryCode: 'MANTENCION_CAMP',
        procurementBucket: 'MANTENCION_CAMP',
        baseUnitSi: 'un',
        unspscCode: '72101500',
        requiredSlots: ['location', 'photoOptional'],
        referenceUnitPriceClp: 65000,
        isCapexAsset: false,
        isControlled: false,
        slotQuestionTemplate: '¿En qué ubicación exacta del campamento es la reparación? (puedes adjuntar foto opcional)',
        defaultCostCenter: 'CC-CAMP-MANTENCION',
    },
    {
        canonicalSkuId: 'SKU-CAPEX-COCINA',
        name: 'Cocina industrial campamento',
        aliases: ['cocina', 'cocina industrial', 'cocinilla industrial', 'horno industrial', 'cocina 4 platos', 'cocina 6 platos', 'cocina campamento'],
        categoryCode: 'ACTIVO_EQUIPAMIENTO',
        procurementBucket: 'ACTIVOS_CAPEX',
        baseUnitSi: 'un',
        unspscCode: '48101500',
        requiredSlots: ['quantity'],
        referenceUnitPriceClp: 480000,
        isCapexAsset: true,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántas cocinas industriales necesitas?',
        defaultCostCenter: 'CC-CAPEX',
    },
    {
        canonicalSkuId: 'SKU-CAPEX-GENERADOR',
        name: 'Generador eléctrico faena',
        aliases: ['generador', 'grupo electrogeno', 'generador electrico', 'planta electrica'],
        categoryCode: 'ACTIVO_EQUIPAMIENTO',
        procurementBucket: 'ACTIVOS_CAPEX',
        baseUnitSi: 'un',
        unspscCode: '26111601',
        requiredSlots: ['quantity'],
        referenceUnitPriceClp: 1650000,
        isCapexAsset: true,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos generadores eléctricos necesitas?',
        defaultCostCenter: 'CC-CAPEX',
    },
    {
        canonicalSkuId: 'SKU-CAPEX-REFRIGERADOR',
        name: 'Refrigerador / Congelador industrial',
        aliases: ['refrigerador', 'congelador', 'freezer', 'refrigerador industrial'],
        categoryCode: 'ACTIVO_EQUIPAMIENTO',
        procurementBucket: 'ACTIVOS_CAPEX',
        baseUnitSi: 'un',
        unspscCode: '48101700',
        requiredSlots: ['quantity'],
        referenceUnitPriceClp: 620000,
        isCapexAsset: true,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos refrigeradores o congeladores necesitas?',
        defaultCostCenter: 'CC-CAPEX',
    },
    {
        canonicalSkuId: 'SKU-CAPEX-EQUIPO-TALLER',
        name: 'Equipo industrial taller (soldadora / compresor / motobomba)',
        aliases: ['soldadora', 'maquina de soldar', 'compresor', 'motobomba'],
        categoryCode: 'ACTIVO_EQUIPAMIENTO',
        procurementBucket: 'ACTIVOS_CAPEX',
        baseUnitSi: 'un',
        unspscCode: '23271400',
        requiredSlots: ['quantity'],
        referenceUnitPriceClp: 890000,
        isCapexAsset: true,
        isControlled: false,
        slotQuestionTemplate: '¿Cuántos equipos industriales de taller necesitas?',
        defaultCostCenter: 'CC-CAPEX',
    },

    // ── CONTROLADOS DGMN (LEY N° 17.798 & DS 43) ────────────────────────────
    {
        canonicalSkuId: 'SKU-EXP-DETONADOR',
        name: 'Detonador / Accesorio de tronadura',
        aliases: ['detonador', 'detonadores', 'explosivo', 'explosivos', 'anfo', 'dinamita', 'tronadura'],
        categoryCode: 'EXPLOSIVOS_REGULADO',
        procurementBucket: 'CONTROLADOS_DGMN',
        baseUnitSi: 'un',
        unspscCode: '12131500',
        requiredSlots: ['quantity'],
        referenceUnitPriceClp: 4500,
        isCapexAsset: false,
        isControlled: true,
        slotQuestionTemplate: '¿Cuántas unidades reguladas de tronadura (requiere licencia DGMN)?',
        defaultCostCenter: 'CC-OPS-TRONADURA',
    },
    {
        canonicalSkuId: 'SKU-QUIM-REACTIVO',
        name: 'Sustancia química controlada DS 43',
        aliases: ['acido sulfurico', 'reactivo controlado', 'cianuro', 'peroxido industrial'],
        categoryCode: 'QUIMICOS_REGULADOS',
        procurementBucket: 'CONTROLADOS_DGMN',
        baseUnitSi: 'L',
        unspscCode: '12161500',
        requiredSlots: ['quantity'],
        referenceUnitPriceClp: 12500,
        isCapexAsset: false,
        isControlled: true,
        slotQuestionTemplate: '¿Cuántos litros de sustancia controlada DS 43 (requiere autorización vigente)?',
        defaultCostCenter: 'CC-OPS-TRONADURA',
    },
];

const ALL_STANDARD_CATEGORIES: SupplyCategoryCode[] = [
    'VIVERES_ALIMENTACION',
    'AGUA_POTABLE_BEBESTIBLE',
    'AGUA_POTABLE_SANITAR',
    'AGUA_INDUSTRIAL',
    'GAS_DOMESTICO_GLP',
    'GASES_INDUSTRIALES',
    'COMBUSTIBLE_CAMPAMENTO',
    'COMBUSTIBLE_FLOTA_PROD',
    'REPUESTOS_MAQUINARIA',
    'LUBRICANTES_FILTROS',
    'FERRETERIA_CONSTRUCCION',
    'HERRAMIENTAS',
    'PERFORACION_ACEROS',
    'FORTIFICACION',
    'ACTIVO_EQUIPAMIENTO',
    'ASEO_HIGIENE',
    'MANTENCION_CAMP',
    'EPP_SEGURIDAD',
    'OTROS_OPERACIONAL',
];

export const DEFAULT_ROLE_PROFILES: Record<SupplyOperationalRole, SupplyMemberProfile> = {
    CAMP_MANAGER: {
        role: 'CAMP_MANAGER',
        allowedCategories: [
            'VIVERES_ALIMENTACION',
            'AGUA_POTABLE_BEBESTIBLE',
            'AGUA_POTABLE_SANITAR',
            'GAS_DOMESTICO_GLP',
            'COMBUSTIBLE_CAMPAMENTO',
            'ASEO_HIGIENE',
            'MANTENCION_CAMP',
        ],
        deniedCategories: ['EXPLOSIVOS_REGULADO', 'QUIMICOS_REGULADOS'],
        maxRequisitionClp: 1_500_000,
        canRecordDirectPurchase: false,
        autoApproveDirectPurchase: false,
        allowCapex: false,
        licensedForControlledItems: false,
        defaultCostCenter: 'CC-CAMP-ALIMENTACION',
        assignedSiteIds: [],
        communicationStyle: { register: 'COLLOQUIAL_FIELD', preferredModality: 'HYBRID', dialect: 'es-CL' },
    },
    MECHANIC_TECH: {
        role: 'MECHANIC_TECH',
        allowedCategories: [
            'REPUESTOS_MAQUINARIA',
            'LUBRICANTES_FILTROS',
            'GASES_INDUSTRIALES',
            'HERRAMIENTAS',
            'COMBUSTIBLE_FLOTA_PROD',
            'FERRETERIA_CONSTRUCCION',
            'EPP_SEGURIDAD',
        ],
        deniedCategories: ['EXPLOSIVOS_REGULADO', 'QUIMICOS_REGULADOS'],
        maxRequisitionClp: 2_500_000,
        canRecordDirectPurchase: false,
        autoApproveDirectPurchase: false,
        allowCapex: false,
        licensedForControlledItems: false,
        defaultCostCenter: 'CC-FLOTA-MANTENCION',
        assignedSiteIds: [],
        communicationStyle: { register: 'TECHNICAL_DIRECT', preferredModality: 'HYBRID', dialect: 'es-CL' },
    },
    OPS_FOREMAN: {
        role: 'OPS_FOREMAN',
        allowedCategories: [
            'FERRETERIA_CONSTRUCCION',
            'HERRAMIENTAS',
            'PERFORACION_ACEROS',
            'FORTIFICACION',
            'AGUA_INDUSTRIAL',
            'EPP_SEGURIDAD',
            'COMBUSTIBLE_FLOTA_PROD',
            'OTROS_OPERACIONAL',
        ],
        deniedCategories: ['EXPLOSIVOS_REGULADO', 'QUIMICOS_REGULADOS'],
        maxRequisitionClp: 3_000_000,
        canRecordDirectPurchase: false,
        autoApproveDirectPurchase: false,
        allowCapex: false,
        licensedForControlledItems: false,
        defaultCostCenter: 'CC-OPS-MINA',
        assignedSiteIds: [],
        communicationStyle: { register: 'TECHNICAL_DIRECT', preferredModality: 'HYBRID', dialect: 'es-CL' },
    },
    WAREHOUSE_KEEPER: {
        role: 'WAREHOUSE_KEEPER',
        allowedCategories: ALL_STANDARD_CATEGORIES.filter((c) => c !== 'ACTIVO_EQUIPAMIENTO'),
        deniedCategories: ['EXPLOSIVOS_REGULADO', 'QUIMICOS_REGULADOS'],
        maxRequisitionClp: 2_000_000,
        canRecordDirectPurchase: false,
        autoApproveDirectPurchase: false,
        allowCapex: false,
        licensedForControlledItems: false,
        defaultCostCenter: 'CC-OPS-MINA',
        assignedSiteIds: [],
        communicationStyle: { register: 'TECHNICAL_DIRECT', preferredModality: 'TEXT', dialect: 'es-CL' },
    },
    HSEC_OFFICER: {
        role: 'HSEC_OFFICER',
        allowedCategories: [
            'EPP_SEGURIDAD',
            'AGUA_POTABLE_BEBESTIBLE',
            'AGUA_POTABLE_SANITAR',
            'ASEO_HIGIENE',
            'MANTENCION_CAMP',
        ],
        deniedCategories: ['EXPLOSIVOS_REGULADO', 'QUIMICOS_REGULADOS'],
        maxRequisitionClp: 2_000_000,
        canRecordDirectPurchase: false,
        autoApproveDirectPurchase: false,
        allowCapex: false,
        licensedForControlledItems: false,
        defaultCostCenter: 'CC-HSEC',
        assignedSiteIds: [],
        communicationStyle: { register: 'TECHNICAL_DIRECT', preferredModality: 'TEXT', dialect: 'es-CL' },
    },
    BUYER: {
        role: 'BUYER',
        allowedCategories: ALL_STANDARD_CATEGORIES,
        deniedCategories: ['EXPLOSIVOS_REGULADO', 'QUIMICOS_REGULADOS'],
        maxRequisitionClp: 5_000_000,
        canRecordDirectPurchase: true,
        autoApproveDirectPurchase: true,
        allowCapex: true,
        licensedForControlledItems: false,
        defaultCostCenter: 'CC-OPS-MINA',
        assignedSiteIds: [],
        communicationStyle: { register: 'TECHNICAL_DIRECT', preferredModality: 'TEXT', dialect: 'es-CL' },
    },
    SITE_ADMIN: {
        role: 'SITE_ADMIN',
        allowedCategories: ALL_STANDARD_CATEGORIES,
        deniedCategories: ['EXPLOSIVOS_REGULADO', 'QUIMICOS_REGULADOS'],
        maxRequisitionClp: 8_000_000,
        canRecordDirectPurchase: true,
        autoApproveDirectPurchase: true,
        allowCapex: true,
        licensedForControlledItems: false,
        defaultCostCenter: 'CC-OPS-MINA',
        assignedSiteIds: [],
        communicationStyle: { register: 'EXECUTIVE_BRIEF', preferredModality: 'TEXT', dialect: 'es-CL' },
    },
    OWNER_EXEC: {
        role: 'OWNER_EXEC',
        allowedCategories: ALL_STANDARD_CATEGORIES,
        deniedCategories: [],
        maxRequisitionClp: undefined,
        canRecordDirectPurchase: true,
        autoApproveDirectPurchase: true,
        allowCapex: true,
        // Compuerta estricta DGMN: jamás se concede licencia controlada sin resolución DGMN vigente
        licensedForControlledItems: false,
        defaultCostCenter: 'CC-OPS-MINA',
        assignedSiteIds: [],
        communicationStyle: { register: 'EXECUTIVE_BRIEF', preferredModality: 'HYBRID', dialect: 'es-CL' },
    },
};

export function findCanonicalSkuById(
    canonicalSkuId: string,
    customCatalog?: readonly CanonicalSupplySku[]
): CanonicalSupplySku | undefined {
    const rawTarget = String(canonicalSkuId || '').trim();
    if (!rawTarget) return undefined;
    const resolvedTarget = resolveCanonicalSkuIdAlias(rawTarget);
    if (customCatalog) {
        const customHit =
            customCatalog.find((item) => item.canonicalSkuId === rawTarget) ||
            customCatalog.find((item) => item.canonicalSkuId === resolvedTarget);
        if (customHit) return customHit;
    }
    return (
        DEFAULT_SUPPLY_CATALOG_SEED.find((item) => item.canonicalSkuId === resolvedTarget) ||
        DEFAULT_SUPPLY_CATALOG_SEED.find((item) => item.canonicalSkuId === rawTarget)
    );
}

/**
 * Empareja texto libre en español chileno/LatAm contra el catálogo canónico
 * por coincidencia determinística de mayor longitud (longest-phrase match).
 */
export function matchCanonicalSkuByText(
    rawText: string,
    customCatalog?: readonly CanonicalSupplySku[]
): CanonicalSupplySku | undefined {
    const normalized = normalizeCatalogText(rawText);
    if (!normalized) return undefined;

    const catalog: CanonicalSupplySku[] = [
        ...(customCatalog ? [...customCatalog] : []),
        ...DEFAULT_SUPPLY_CATALOG_SEED,
    ];

    let bestMatch: { sku: CanonicalSupplySku; score: number } | undefined;

    for (const sku of catalog) {
        const candidates = [sku.name, ...sku.aliases].map(normalizeCatalogText).filter(Boolean);
        for (const phrase of candidates) {
            const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const wordRegex = new RegExp(`(^|\\s)${escaped}(\\s|$)`);
            if (wordRegex.test(normalized)) {
                const score = phrase.length * 10 + (phrase === normalized ? 100 : 0);
                if (!bestMatch || score > bestMatch.score) {
                    bestMatch = { sku, score };
                }
            }
        }
    }

    return bestMatch?.sku;
}
