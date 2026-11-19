import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    OperationalCostMatrixSchema,
    SupplyItemFamilySchema,
} from '../../contracts/opermaq.contracts';
import { AssetOntologyEngine } from '../../modules/opermaq/services/AssetOntologyEngine';
import {
    compileEquipmentCostMatrixFromPillars,
    computeCostMatrixSourceDigest,
    COST_MATRIX_SCHEMA_VERSION,
} from '../../modules/opermaq/services/EquipmentCostMatrixCompiler';
import type { PillarDocument } from '../../modules/opermaq/types/vault.types';

const REPO_ROOT = path.resolve(__dirname, '../../..');

function makePillarDoc(
    pillarId: 'ficha_tecnica' | 'pauta_mantencion',
    items: Array<{ id: string; title: string; content: string; is_discarded?: boolean }>
): PillarDocument {
    return {
        pillar_id: pillarId,
        label: pillarId,
        items: items.map((item) => ({
            id: item.id,
            title: item.title,
            content: item.content,
            content_status: 'COMPLETADO',
            is_discarded: Boolean(item.is_discarded),
        })),
    } as unknown as PillarDocument;
}

// ============================================================================
// 1. ONTOLOGÍA LIMPIA + DESCONTAMINACIÓN EN CAT 242D, 272D XHP, MACK, SMARTROC
// ============================================================================
function testOntologyDecontamination(): void {
    // Caso A: CAT 242D ESTANDAR con palabras trampa ("ROC", "manual", "martillos", "CTL" en notas comparativas)
    // y existing_traits corruptos NO bloqueados por humano.
    const cat242dTraits = AssetOntologyEngine.inferAssetPhysicalTraits({
        type_key: 'minicargador',
        canonical_type_es: 'Minicargador',
        categoria_equipo: 'MINICARGADORES',
        make_oficial: 'CATERPILLAR',
        model_oficial: '242D ESTANDAR',
        caracteristicas_principales: [
            'Minicargador sobre neumáticos 12x16.5.',
            'Compatible con martillos hidráulicos auxiliares.',
            'Consultar manual del operador y norma ROC interna.',
        ],
        ambiente_operativo: ['Superficie y acopio minero'],
        contexto_operativo: ['Carguío liviano, limpieza con balde y tolva remolque auxiliar'],
        existing_traits: {
            functional_domain: 'DRILLING_AND_GROUND_SUPPORT',
            mobility: 'TOWED_TRAILER',
            duty_travel_regime: 'STATIONARY_DUTY',
            primary_energy: 'NEUMATICO_AIRE_COMPRIMIDO',
            material_symbol_icon: 'hardware',
            locked_by_human: false,
        } as any,
    });

    assert.equal(cat242dTraits.functional_domain, 'EARTHMOVING_EXCAVATION');
    assert.equal(cat242dTraits.mobility, 'SELF_PROPELLED_WHEELED');
    assert.equal(cat242dTraits.primary_energy, 'DIESEL');

    // Caso A.2: locked_by_human === true debe respetar override humano explícito
    const lockedTraits = AssetOntologyEngine.inferAssetPhysicalTraits({
        type_key: 'minicargador',
        canonical_type_es: 'Minicargador',
        make_oficial: 'CATERPILLAR',
        model_oficial: '242D ESTANDAR',
        existing_traits: {
            functional_domain: 'INDUSTRIAL_GENERAL',
            mobility: 'SELF_PROPELLED_TRACKED',
            duty_travel_regime: 'OFF_ROAD_SITE',
            primary_energy: 'ELECTRICO_BATERIA_BEV',
            material_symbol_icon: 'forklift',
            locked_by_human: true,
        } as any,
    });
    assert.equal(lockedTraits.primary_energy, 'ELECTRICO_BATERIA_BEV');
    assert.equal(lockedTraits.mobility, 'SELF_PROPELLED_TRACKED');

    // Caso B: CAT 272D XHP (sobre ruedas, alto flujo hidráulico auxiliar)
    const cat272dTraits = AssetOntologyEngine.inferAssetPhysicalTraits({
        canonical_type_es: 'Minicargador de Alto Flujo',
        categoria_equipo: 'MINICARGADORES',
        make_oficial: 'CATERPILLAR',
        model_oficial: '272D XHP',
        caracteristicas_principales: [
            'Circuito hidráulico auxiliar XHP.',
            'Ver manual de servicio.',
            'No confundir con variante CTL sobre orugas.',
        ],
    });
    assert.equal(cat272dTraits.functional_domain, 'EARTHMOVING_EXCAVATION');
    assert.equal(cat272dTraits.mobility, 'SELF_PROPELLED_WHEELED');
    assert.equal(cat272dTraits.primary_energy, 'DIESEL');

    // Caso C: Camiones Mack Granite GU813 8x4 Automatic y GU813 MP8
    const mackAutoTraits = AssetOntologyEngine.inferAssetPhysicalTraits({
        canonical_type_es: 'Camión Tolva',
        categoria_equipo: 'CAMIONES',
        make_oficial: 'MACK',
        model_oficial: 'GRANITE GU813 8X4 AUTOMATIC',
        caracteristicas_principales: [
            'Camión tolva 8x4 apto para tiro de remolque opcional, frenos de aire comprimido y manual técnico OEM.',
        ],
    });
    assert.equal(mackAutoTraits.mobility, 'SELF_PROPELLED_WHEELED');
    assert.equal(mackAutoTraits.primary_energy, 'DIESEL');
    assert.notEqual(mackAutoTraits.duty_travel_regime, 'STATIONARY_DUTY');

    const mackMp8Traits = AssetOntologyEngine.inferAssetPhysicalTraits({
        canonical_type_es: 'Camión Tracto / Tolva',
        categoria_equipo: 'CAMIONES',
        make_oficial: 'MACK',
        model_oficial: 'GU813 MP8',
        caracteristicas_principales: [
            'Motor diésel MP8. Manual de operación carretera/faena. Sin propulsión híbrida.',
        ],
    });
    assert.equal(mackMp8Traits.mobility, 'SELF_PROPELLED_WHEELED');
    assert.equal(mackMp8Traits.primary_energy, 'DIESEL');

    // Caso D: Preservación positiva en perforadora real Epiroc SmartROC D65
    const smartRocTraits = AssetOntologyEngine.inferAssetPhysicalTraits({
        canonical_type_es: 'Perforadora de Superficie DTH',
        categoria_equipo: 'PERFORACIÓN DE SUPERFICIE',
        make_oficial: 'EPIROC',
        model_oficial: 'SmartROC D65',
        caracteristicas_principales: [
            'Perforadora sobre orugas con martillo en fondo DTH y carrusel de barras.',
        ],
    });
    assert.equal(smartRocTraits.functional_domain, 'DRILLING_AND_GROUND_SUPPORT');
    assert.equal(smartRocTraits.mobility, 'SELF_PROPELLED_TRACKED');
    assert.equal(smartRocTraits.primary_energy, 'DIESEL');
}

// ============================================================================
// 2. COMPILACIÓN DE INSUMOS Y PIEZAS AD HOC PARA CAT 242D ESTANDAR
// ============================================================================
function testCat242dSupplyMatrixCompilation(): void {
    const assetData = {
        id: 'caterpillar_242d_estandar',
        equipment_type_key: 'minicargador',
        tipo_equipo: 'Minicargador',
        categoria_equipo: 'MINICARGADORES',
        make_oficial: 'CATERPILLAR',
        model_oficial: '242D ESTANDAR',
        caracteristicas_principales: [
            'Minicargador Cat C3.3B DIT sobre ruedas con balde cargador estándar.',
        ],
        ambiente_operativo: ['Superficie industrial / faena'],
        contexto_operativo: ['Movimiento de tierra, compatible con martillos y barredoras según manual.'],
    };

    const fichaDoc = makePillarDoc('ficha_tecnica', [
        {
            id: 'ficha_tecnica_motor_01',
            title: 'Motor, Potencia y Combustible',
            content: [
                '| Parámetro | Especificación OEM |',
                '|---|---|',
                '| Combustible | Diésel ULSD (Ultra Bajo Azufre) |',
                '| Capacidad Tanque Combustible | 105 L |',
                '| Consumo Medio Operacional | 7,6 L/h |',
                '| Sistema de Refrigeración | 14 L (Cat ELC) |',
            ].join('\n'),
        },
        {
            id: 'ficha_tecnica_tren_02',
            title: 'Tren de Rodamiento, Neumáticos y Capacidades',
            content: [
                '| Subsistema | Especificación OEM | Cantidad / Capacidad |',
                '|---|---|---|',
                '| Neumáticos Estándar | 12 x 16.5 (10 PR) | 4 unid. |',
                '| Tanque Hidráulico | Cat HYDO Advanced 10 | 39 L (Capacidad total del circuito: 50 L) |',
                '| Cajas de Cadenas (Lado Izq. / Der.) | Cat TDTO (TO-4) / SAE 10W-30 | 8,8 L por caja (17,6 L total) |',
            ].join('\n'),
        },
        {
            id: 'ficha_tecnica_unidad_de_perforacion_martillo_energia_y_frecuen_11',
            title: 'Unidad de Perforación, Martillo, Energía y Frecuencia',
            content:
                '*(Sección omitida al 100% — El equipo CATERPILLAR 242D ESTANDAR no posee físicamente unidad de perforación ni sarta de barras).*',
        },
    ]);

    const mantencionDoc = makePillarDoc('pauta_mantencion', [
        {
            id: 'pm_inspecciones_01',
            title: 'Inspecciones Diarias y Monitoreo (PM0 / S·O·S)',
            content: [
                '| Tarea / Elemento | Acción | Frecuencia | Nota / Puntos |',
                '|---|---|---|---|',
                '| Niveles de fluidos y neumáticos | Inspeccionar / verificar presión | Cada 10 h | Rutina operador |',
                '| Muestra aceite de motor S·O·S | Muestreo / Análisis de laboratorio | Cada 250 h | Botella S·O·S |',
                '| Puntos de engrase articulación (Zerk) | Lubricar pasadores y pivotes | Cada 10 h - 50 h | 16 graseras (Zerk) |',
            ].join('\n'),
        },
        {
            id: 'pm_fluidos_02',
            title: 'Fluidos y Lubricantes Periódicos',
            content: [
                '| Compartimento | Especificación / Viscosidad | Volumen de Recambio | Intervalo |',
                '|---|---|---|---|',
                '| Cárter Motor Diésel | Cat DEO-ULS SAE 15W-40 | 11,2 L | Cada 500 h |',
                '| Tanque Hidráulico | Cat HYDO Advanced 10 | 39 L | Cada 1.000 h |',
                '| Cajas de Cadenas (x2) | Cat HYDO Advanced 10 | 17,6 L (2 x 8,8 L) | Cada 1.000 h |',
                '| Sistema de Refrigeración | Cat ELC Extended Life Coolant | 14 L | Cada 12.000 h |',
                '| Grasa Articulación y Pivotes | Cat Advanced 3Moly NLGI 2 | Según consumo (16 Zerk) | Cada 50 h |',
            ].join('\n'),
        },
        {
            id: 'pm_filtros_03',
            title: 'Filtros, Respiraderos y Postratamiento OEM',
            content: [
                '| Elemento Filtrante / Repuesto | Sistema | Código OEM | Cantidad | Intervalo |',
                '|---|---|---|---|---|',
                '| Filtro de Aceite de Motor | Motor | 377-6969 | 1 unid. | Cada 500 h |',
                '| Filtro Primario de Combustible / Separador | Combustible | 363-5819 | 1 unid. | Cada 500 h |',
                '| Filtro Secundario de Combustible | Combustible | 416-5884 | 1 unid. | Cada 500 h |',
                '| Filtro de Aceite Hidráulico | Hidráulico | 421-5479 | 1 unid. | Cada 500 h |',
                '| Filtro de Aire Primario | Admisión | 110-6326 | 1 unid. | Cada 500 h |',
                '| Filtro de Aire Secundario | Admisión | 110-6331 | 1 unid. | Cada 1.000 h |',
                '| Filtro Aire Cabina | Cabina | 265-6618 | 1 unid. | Cada 500 h |',
                '| Respiradero Tanque Hidráulico | Hidráulico | - | 1 unid. | Cada 250 h |',
                '| Filtro Partículas Diésel (DPF) | Postratamiento | - | 1 unid. | Cada 3.000 h |',
            ].join('\n'),
        },
        {
            id: 'pm_desgaste_04',
            title: 'Elementos de Desgaste Operacional y Neumáticos',
            content: [
                '| Elemento / Repuesto | Sistema / Posición | Especificación / Medida | Código OEM | Cantidad | Vida Útil |',
                '|---|---|---|---|---|---|',
                '| Cuchilla Reemplazable Balde (Bolt-On Cutting Edge) | Balde Cargador | Acero DH-2 1730 mm | - | 1 unid. | 800 h |',
                '| Barra de perforación R38 (ruido plantilla) | Unidad perforación | R38 3050 mm | - | 2 unid. | 600 h |',
                '| Neumáticos Estándar | Tracción 4x4 | 12 x 16.5 (10 PR) | - | 4 unid. | 2.000 h |',
            ].join('\n'),
        },
    ]);

    const matrix = compileEquipmentCostMatrixFromPillars({
        assetData,
        fichaDoc,
        mantencionDoc,
    });

    // Validación estricta contra el contrato Zod
    const parsed = OperationalCostMatrixSchema.parse(matrix);
    assert.equal(parsed.version, COST_MATRIX_SCHEMA_VERSION);
    assert.equal(parsed.version, '4.0.0');

    const expectedDigest = computeCostMatrixSourceDigest({
        assetData,
        fichaDoc,
        mantencionDoc,
    });
    assert.ok(expectedDigest);
    assert.equal(parsed.source_merkle_root_sha256, expectedDigest);

    const items = parsed.supply_items;
    assert.ok(items.length >= 10, `Se esperaban >= 10 insumos en CAT 242D, obtenidos ${items.length}`);

    // 1. CERO contaminación de perforación en insumos y wear_parts_get
    for (const item of items) {
        const joined = `${item.item_name} ${item.subsystem} ${item.oem_spec_or_size || ''}`.toLowerCase();
        assert.ok(
            !/\b(barra de perforaci[oó]n|broca|martillo dth|culat[ií]n|sarta de perforaci[oó]n|r38)\b/i.test(
                joined
            ),
            `Contaminación de perforación detectada en CAT 242D: ${item.item_name}`
        );
    }
    for (const wp of parsed.wear_parts_get) {
        assert.ok(
            !/barra|perforaci[oó]n|broca|dth/i.test(wp.part_name),
            `wear_parts_get contaminado en CAT 242D: ${wp.part_name}`
        );
    }

    // 2. CERO inspecciones diarias 10 h ni botellas de muestreo S·O·S como insumos de reemplazo
    for (const item of items) {
        const lowerName = item.item_name.toLowerCase();
        assert.ok(
            !lowerName.includes('niveles de fluidos') && !lowerName.includes('inspeccion'),
            `Inspección no consumible colada en supply_items: ${item.item_name}`
        );
        assert.ok(
            !lowerName.includes('s·o·s') && !lowerName.includes('muestreo'),
            `Muestreo S·O·S colado en supply_items: ${item.item_name}`
        );
        assert.ok(
            !lowerName.startsWith('puntos de engrase'),
            `Tabla Zerk cruda colada como ítem independiente en lugar de consolidarse en GRASA: ${item.item_name}`
        );
    }

    // 3. CERO intervalos horarios ("250 h") dentro de oem_part_number
    for (const item of items) {
        if (item.oem_part_number) {
            assert.ok(
                !/\d+\s*h\b/i.test(item.oem_part_number),
                `Intervalo horario filtrado como código OEM en ${item.item_name}: ${item.oem_part_number}`
            );
        }
    }

    // 4. Presencia de neumáticos ad hoc (12 x 16.5, 4 unid.)
    const tireItem = items.find((i) => i.family === 'NEUMATICO');
    assert.ok(tireItem, 'Debe incluir familia NEUMATICO para CAT 242D sobre ruedas');
    assert.ok(
        /12\s*x\s*16\.5/i.test(tireItem.oem_spec_or_size || ''),
        `Medida neumático inesperada: ${tireItem.oem_spec_or_size}`
    );
    assert.ok(
        /4\b/.test(tireItem.change_or_installed_qty || ''),
        `Cantidad de neumáticos esperada 4 unid., obtenida: ${tireItem.change_or_installed_qty}`
    );

    // 5. Tanque Hidráulico 39 L recambio y nota de 50 L circuito total (sin mezclar volúmenes)
    const hydroFluid = items.find(
        (i) => i.family === 'LUBRICANTE' && /hidr[aá]ulic/i.test(`${i.item_name} ${i.subsystem}`)
    );
    assert.ok(hydroFluid, 'Debe incluir fluido de Tanque Hidráulico');
    assert.ok(
        hydroFluid.change_or_installed_qty?.includes('39'),
        `Volumen recambio hidráulico esperado 39 L, obtenido: ${hydroFluid.change_or_installed_qty}`
    );

    // 6. Cajas de cadenas con conflicto OEM explícito marcado en spec_conflict
    const chainCase = items.find((i) => /cadena/i.test(`${i.item_name} ${i.subsystem}`));
    assert.ok(chainCase, 'Debe incluir lubricante de Cajas de Cadenas');
    assert.ok(
        chainCase.spec_conflict && chainCase.spec_conflict.length > 0,
        'Debe detectar discrepancia de especificación OEM en Cajas de Cadenas (TDTO vs HYDO)'
    );

    // 7. Respiradero sin código OEM (no 250 h), DPF en POSTRATAMIENTO, y filtros con códigos OEM
    const breather = items.find((i) => i.family === 'RESPIRADERO');
    assert.ok(breather, 'Debe incluir RESPIRADERO del tanque hidráulico');
    assert.equal(breather.oem_part_number, null);

    const dpf = items.find(
        (i) => i.family === 'POSTRATAMIENTO' && /dpf/i.test(i.item_name)
    );
    assert.ok(dpf, 'Debe incluir DPF en familia POSTRATAMIENTO');

    const oemCodesFound = new Set(items.map((i) => i.oem_part_number).filter(Boolean));
    for (const code of ['377-6969', '363-5819', '416-5884', '421-5479', '110-6326', '110-6331', '265-6618']) {
        assert.ok(oemCodesFound.has(code), `Falta código OEM esperado ${code}`);
    }

    // 8. Combustible Diésel + Cuchilla de desgaste presentes
    assert.ok(items.some((i) => i.family === 'COMBUSTIBLE'));
    assert.ok(items.some((i) => i.family === 'DESGASTE' && /cuchilla/i.test(i.item_name)));

    // 9. Todos los ítems pertenecen al enum oficial SupplyItemFamilySchema
    for (const item of items) {
        SupplyItemFamilySchema.parse(item.family);
    }
}

// ============================================================================
// 3. GUARDRAILS ESTÁTICOS DE UI MÍNIMA Y PARIDAD i18n (es / en / pt)
// ============================================================================
function testPanelAndLocaleGuardrails(): void {
    const panelSrc = fs.readFileSync(
        path.join(REPO_ROOT, 'web/src/modules/opermaq/components/EquipmentCostMatrixPanel.tsx'),
        'utf8'
    );

    // Cero tarjetas, cero prose KPI/CAPEX, cero badges amarillos, cero fuentes prohibidas
    assert.ok(!/#FFCD00/i.test(panelSrc), 'Prohibido #FFCD00 en EquipmentCostMatrixPanel.tsx');
    assert.ok(
        !/\b(?:Google Sans|Roboto|Inter)\b/i.test(panelSrc),
        'Fuente no autorizada en EquipmentCostMatrixPanel.tsx'
    );
    assert.ok(!/rounded-(sm|md|lg|xl|2xl|full)/.test(panelSrc), 'Borde redondeado prohibido en EquipmentCostMatrixPanel.tsx');
    assert.ok(!/shadow-(sm|md|lg|xl|2xl)/.test(panelSrc), 'Sombra prohibida en EquipmentCostMatrixPanel.tsx');
    assert.ok(!/sec1_title|sec7_title|capex_and_depreciation/.test(panelSrc), 'No debe renderizar bloques CAPEX/PM en la tabla');
    assert.ok(
        !/text-\[(?:[0-9]|1[0-2])px\]|text-xs\b/.test(panelSrc),
        'Prohibidas clases de fuente < 13px (accessibility 18-120 guardrail)'
    );
    assert.ok(panelSrc.includes('autoComplete="off"'), 'Debe exigir autoComplete="off" en el input');
    assert.ok(panelSrc.includes('spellCheck={false}'), 'Debe exigir spellCheck={false} en el input');
    assert.ok(panelSrc.includes('dark:'), 'Debe soportar variantes duales dark:');
    assert.ok(panelSrc.includes('<table'), 'Debe renderizar tabla funcional');

    const locales = ['es', 'en', 'pt'].map((lang) => ({
        lang,
        data: JSON.parse(
            fs.readFileSync(path.join(REPO_ROOT, `web/src/modules/opermaq/locales/${lang}.json`), 'utf8')
        ),
    }));

    const requiredCostMatrixKeys = [
        'col_supply_family',
        'col_supply_item',
        'col_subsystem',
        'col_oem_spec_size',
        'col_oem_part',
        'col_qty_volume',
        'col_interval_life',
        'col_rate_1000h',
        'filter_all',
        'search_placeholder',
        'clear_search_aria',
        'conflict_label',
        'empty_list',
        ...SupplyItemFamilySchema.options.map((family) => `family_${family}`),
    ];

    for (const { lang, data } of locales) {
        assert.ok(data.opermaq_domains?.not_declared, `${lang}.json debe contener opermaq_domains.not_declared`);
        for (const key of requiredCostMatrixKeys) {
            assert.ok(
                typeof data.cost_matrix?.[key] === 'string' && data.cost_matrix[key].trim().length > 0,
                `Falta cost_matrix.${key} en locales/${lang}.json`
            );
        }
    }
}

testOntologyDecontamination();
testCat242dSupplyMatrixCompilation();
testPanelAndLocaleGuardrails();
console.log('OK: opermaq-cost-supplies-catalog.test.ts (ontología limpia, CAT 242D insumos/neumáticos/conflictos OEM, UI plana y paridad i18n)');
