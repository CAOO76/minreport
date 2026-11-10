import { describe, expect, it } from 'vitest';
import {
    FleetUnitRegistrationSchema,
    GlobalEquipmentTypeSchema,
    TenantPrivatePhotoSchema,
} from '../../../../contracts';
import {
    resolveEffectiveOpermaqDomain,
    resolveOpermaqCapabilities,
} from '../../hooks/useOpermaqContext';
import {
    ARCHETYPE_DEFINITIONS,
    buildEquipmentShortDescription,
    cleanCanonicalAxisValue,
    cleanMachineryTypeLabel,
    countPublishedPillars,
    groupEquipmentByBrandAndType,
    MISSING_AXIS_VALUE,
    MISSING_TECH_SPEC,
    normalizeCompactSerialIdentifier,
    sortEquipmentByBrandAndType,
    validateCrossAxisPhysicalPlausibility,
} from '../opermaqDomainProjection';

describe('OPERMAQ — Separación Estricta de Dominios CATÁLOGO y FLOTA', () => {
    it('ordena y agrupa registros determinísticamente por Marca -> Tipo de Maquinaria -> Modelo -> N° de Serie', () => {
        const unsorted = [
            {
                id: 'u-3',
                make_oficial: 'KOMATSU',
                model_oficial: 'PC200-8',
                tipo_equipo: 'Excavadora Hidráulica',
                serial_number: 'KMTPC200-009',
            },
            {
                id: 'u-1',
                make_oficial: 'CATERPILLAR',
                model_oficial: '242D',
                tipo_equipo: 'Minicargador Frontal',
                serial_number: 'CAT0242D-010',
            },
            {
                id: 'u-2',
                make_oficial: 'CATERPILLAR',
                model_oficial: '242D',
                tipo_equipo: 'Minicargador Frontal',
                serial_number: 'CAT0242D-002',
            },
            {
                id: 'u-4',
                make_oficial: 'CATERPILLAR',
                model_oficial: '966H',
                tipo_equipo: 'Cargador Frontal de Ruedas',
                serial_number: 'CAT0966H-771',
            },
        ];

        const sorted = sortEquipmentByBrandAndType(unsorted);
        expect(sorted.map((r) => r.id)).toEqual(['u-4', 'u-2', 'u-1', 'u-3']);

        const groups = groupEquipmentByBrandAndType(unsorted);
        expect(groups).toHaveLength(3);
        expect(groups[0].brandLabel).toBe('CATERPILLAR');
        expect(groups[0].machineryTypeLabel).toBe('CARGADOR FRONTAL DE RUEDAS');
        expect(groups[1].brandLabel).toBe('CATERPILLAR');
        expect(groups[1].machineryTypeLabel).toBe('MINICARGADOR FRONTAL');
        expect(groups[1].items.map((x) => x.serial_number)).toEqual([
            'CAT0242D-002',
            'CAT0242D-010',
        ]);
        expect(groups[2].brandLabel).toBe('KOMATSU');
    });

    it('contabiliza en los 5 pilares únicamente aquellos con ítems APROBADO_HUMANO publicados', () => {
        const vault = {
            ficha_tecnica: {
                items: [
                    {
                        item_id: 'ft_1',
                        content_status: 'COMPLETADO',
                        estado_aprobacion: 'APROBADO_HUMANO',
                        content: 'Potencia neta 54.6 kW',
                        is_discarded: false,
                    },
                ],
            },
            manual_operaciones: {
                items: [
                    {
                        item_id: 'mo_1',
                        content_status: 'COMPLETADO',
                        estado_aprobacion: 'GENERADO_IA',
                        content: 'Borrador pendiente de revisión humana',
                        is_discarded: false,
                    },
                ],
            },
            pauta_mantencion: {
                items: [
                    {
                        item_id: 'pm_1',
                        content_status: 'COMPLETADO',
                        estado_aprobacion: 'APROBADO_HUMANO',
                        content: 'Cambio de aceite cada 250 hrs',
                        is_discarded: true, // descartado -> no debe contarse
                    },
                ],
            },
            matriz_riesgos: {
                items: [
                    {
                        item_id: 'mr_1',
                        content_status: 'COMPLETADO',
                        estado_aprobacion: 'APROBADO_HUMANO',
                        content: 'Bloqueo LOTO hidráulico obligatorio',
                        is_discarded: false,
                    },
                ],
            },
            checklist_pre_op: { items: [] },
        };

        expect(countPublishedPillars(vault)).toBe(2);
        expect(countPublishedPillars(null)).toBe(0);
    });

    it('erradica alucinaciones comerciales (caso CAT 242D) e impone vectores homólogos comparables 1 a 1 por arquetipo (caso Bulldozers D10)', () => {
        expect(normalizeCompactSerialIdentifier(' cat-0242d / jdzt 01492 ')).toBe(
            'CAT0242DJDZT01492'
        );
        expect(buildEquipmentShortDescription({})).toBe(MISSING_TECH_SPEC);
        expect(
            cleanMachineryTypeLabel(
                'Minicargador de Chasis Rígido sobre Neumáticos (Skid Steer Loader — Cinemática de Levante Vertical, Serie D)'
            )
        ).toBe('Minicargador de Chasis Rígido sobre Neumáticos');

        // 1. Cortafuegos Anti-Alucinación (Caso real CAT 242D):
        // Bloquea la afirmación falsa "carga de camiones" / "mayor alcance" y proyecta el vector canónico homólogo SSL
        const contaminatedCat242d = buildEquipmentShortDescription({
            tipo_equipo:
                'Minicargador de Chasis Rígido sobre Neumáticos (Skid Steer Loader — Cinemática de Levante Vertical, Serie D)',
            contexto_operativo: ['Carguío compacto'],
            caracteristicas_principales: [
                'Período de producción: 2013 - 2020 (Primera generación Serie D)',
                'Capacidad nominal de operación (ROC): 975 kg (2.150 lb)',
                'Peso operativo: 3.166 kg (6.980 lb)',
                'Diseño de levantamiento vertical que proporciona mayor alcance y altura de elevación para carga de camiones',
            ],
        });
        expect(contaminatedCat242d).not.toContain('camiones');
        expect(contaminatedCat242d).not.toContain('mayor alcance');
        expect(contaminatedCat242d).toBe(
            `ROC: 975 kg (2.150 lb) · Altura máx. descarga: ${MISSING_AXIS_VALUE} · Potencia neta: ${MISSING_AXIS_VALUE} · Peso operativo: 3.166 kg (6.980 lb) · Cinemática: Levante vertical`
        );

        // Tampoco infiere cinemática desde una oración contaminada con marketing si `tipo_equipo` no la declara
        const untrustedKinematics = buildEquipmentShortDescription({
            tipo_equipo: 'Minicargador de Chasis Rígido sobre Neumáticos',
            caracteristicas_principales: [
                'Capacidad nominal de operación (ROC): 800 kg',
                'Diseño de levantamiento vertical que proporciona mayor alcance para carga fácil de camiones',
            ],
        });
        expect(untrustedKinematics).not.toContain('Levante vertical');
        expect(untrustedKinematics).toBe(
            `ROC: 800 kg · Altura máx. descarga: ${MISSING_AXIS_VALUE} · Potencia neta: ${MISSING_AXIS_VALUE} · Peso operativo: ${MISSING_AXIS_VALUE}`
        );

        // 2. Comparabilidad 1 a 1 entre equipos de la misma familia (`BULLDOZER SOBRE ORUGAS`: D10 NEXT GEN vs D10N)
        // Ambos exponen exactamente los mismos 3 ejes obligatorios en idéntico orden: Potencia neta · Peso operativo · Hoja
        const d10NextGenLegacy = buildEquipmentShortDescription({
            tipo_equipo: 'Bulldozer sobre Orugas',
            contexto_operativo: ['Empuje masivo de material'],
            caracteristicas_principales: [
                'Capacidad de hoja (U-Blade): 34.4 m³',
                'Motor Cat C27 — Potencia neta: 449 kW (602 HP) (Tier 4 Final)',
            ],
        });
        const d10nLegacy = buildEquipmentShortDescription({
            tipo_equipo: 'Bulldozer sobre Orugas',
            contexto_operativo: ['Empuje masivo de material'],
            caracteristicas_principales: [
                'Potencia neta: 388 kW (520 HP)',
                'Caudal hidráulico: 468 L/min',
            ],
        });

        expect(d10NextGenLegacy).toBe(
            `Potencia neta: 449 kW (602 HP) · Peso operativo: ${MISSING_AXIS_VALUE} · Hoja: 34.4 m³`
        );
        expect(d10nLegacy).toBe(
            `Potencia neta: 388 kW (520 HP) · Peso operativo: ${MISSING_AXIS_VALUE} · Hoja: ${MISSING_AXIS_VALUE}`
        );

        // Tras consolidación HITL (`canonical_specs`), el vector completo se proyecta íntegro sin truncar
        const d10NextGenHomologated = buildEquipmentShortDescription({
            archetype_id: 'BULLDOZER_ORUGAS',
            tipo_equipo: 'Bulldozer sobre Orugas',
            canonical_specs: [
                { axis_key: 'potencia_neta', label_es: 'Potencia neta', value_si: '449 kW (602 HP)' },
                { axis_key: 'peso_operativo', label_es: 'Peso operativo', value_si: '70.170 kg' },
                { axis_key: 'capacidad_hoja', label_es: 'Hoja', value_si: '34,4 m³ (U)' },
                { axis_key: 'tren_rodaje', label_es: 'Rodaje', value_si: 'Rueda cabilla elevada' },
            ],
        });
        expect(d10NextGenHomologated).toBe(
            'Potencia neta: 449 kW (602 HP) · Peso operativo: 70.170 kg · Hoja: 34,4 m³ (U) · Rodaje: Rueda cabilla elevada'
        );

        // 3. Cobertura universal de vehículos (ej. Pick-up 4x4 PEUGEOT LANDTREK vs TOYOTA HILUX)
        const peugeotLandtrek = buildEquipmentShortDescription({
            tipo_equipo: 'Camioneta Pick-up Doble Cabina',
            caracteristicas_principales: [
                'Potencia: 110 kW (150 HP)',
                'Torque: 350 N·m',
                'Carga útil: 1.020 kg',
                'Tracción: 4x4',
            ],
        });
        expect(peugeotLandtrek).toBe(
            'Potencia: 110 kW (150 HP) · Torque: 350 N·m · Carga útil: 1.020 kg · Tracción: 4x4'
        );
    });

    it('valida plausibilidad física cruzada entre ejes (ISO 14397 ROC vs Peso operativo y envolvente de descarga)', () => {
        const valid242d = validateCrossAxisPhysicalPlausibility('MINICARGADOR_SSL_CTL', [
            { axis_key: 'capacidad_nominal_roc', label_es: 'ROC', value_si: '975 kg' },
            { axis_key: 'altura_max_descarga', label_es: 'Altura máx. descarga', value_si: '2.286 mm' },
            { axis_key: 'potencia_neta', label_es: 'Potencia neta', value_si: '54,6 kW' },
            { axis_key: 'peso_operativo', label_es: 'Peso operativo', value_si: '3.166 kg' },
        ]);
        expect(valid242d.valid).toBe(true);
        expect(valid242d.rejectedAxes).toHaveLength(0);

        const impossibleSkidSteer = validateCrossAxisPhysicalPlausibility('MINICARGADOR_SSL_CTL', [
            { axis_key: 'capacidad_nominal_roc', label_es: 'ROC', value_si: '2.900 kg' },
            { axis_key: 'altura_max_descarga', label_es: 'Altura máx. descarga', value_si: '6.800 mm' },
            { axis_key: 'peso_operativo', label_es: 'Peso operativo', value_si: '3.166 kg' },
        ]);
        expect(impossibleSkidSteer.valid).toBe(false);
        expect(impossibleSkidSteer.rejectedAxes).toContain('capacidad_nominal_roc');
        expect(impossibleSkidSteer.rejectedAxes).toContain('altura_max_descarga');
    });

    it('exige Número de Serie/Identificador único y palabra clave ACTUALIZAR en el contrato Zod de Flota', () => {
        const invalidMissingKeyword = FleetUnitRegistrationSchema.safeParse({
            make_oficial: 'CATERPILLAR',
            model_oficial: '242D',
            identifier_type: 'SERIAL_NUMBER',
            identifier_value: 'CAT0242DJDZT01492',
            ownership_type: 'PROPIO',
            confirm_word: 'GUARDAR',
        });
        expect(invalidMissingKeyword.success).toBe(false);

        const validEnrollment = FleetUnitRegistrationSchema.safeParse({
            make_oficial: 'CATERPILLAR',
            model_oficial: '242D',
            identifier_type: 'SERIAL_NUMBER',
            identifier_value: 'CAT0242DJDZT01492',
            ownership_type: 'PROPIO',
            horometer: 1240,
            confirm_word: 'ACTUALIZAR',
        });
        expect(validEnrollment.success).toBe(true);

        const validPrivatePhoto = TenantPrivatePhotoSchema.safeParse({
            sha256: 'a'.repeat(64),
            url: '/api/media/blob/tenant/tenant-demo/' + 'a'.repeat(64) + '.webp',
            uploadedAt: '2026-11-05T21:00:00.000Z',
        });
        expect(validPrivatePhoto.success).toBe(true);
    });

    it('en cabina DEV (/dev con dev_auth_token), front_loader abre CATÁLOGO y lists abre FLOTA incluso sin sesión cliente previa; en B2B/EDU fuerza siempre FLOTA', () => {
        // 1º DEV en /dev con dev_auth_token (aún si MinReportSessionContext es null tras recarga)
        const devCaps = resolveOpermaqCapabilities({
            hostScope: 'DEV_GATEWAY',
            session: null,
            hasDevGatewayToken: true,
        });
        expect(devCaps.canCurateAI).toBe(true);
        expect(devCaps.canManageFleet).toBe(true);
        expect(resolveEffectiveOpermaqDomain('CATALOG', devCaps)).toBe('CATALOG');
        expect(resolveEffectiveOpermaqDomain('FLEET', devCaps)).toBe('FLEET');
        expect(resolveEffectiveOpermaqDomain('SYMBOLOGY', devCaps)).toBe('SYMBOLOGY');

        // 4º B2B en ruta cliente (/opermaq): jamás puede abrir CATÁLOGO aunque reciba token residual en localStorage
        const b2bCaps = resolveOpermaqCapabilities({
            hostScope: 'CLIENT',
            session: {
                uid: 'b2b-uid-1',
                email: 'operaciones@faena.cl',
                displayName: 'Jefe Flota',
                tenantId: 'tenant-faena-1',
                tenantName: 'Faena Norte',
                role: 'ADMIN',
                classification: 'b2b',
                accountTier: 4,
                isDevRoot: false,
                isSuperAdmin: false,
                isTestPilot: false,
                isEduSandbox: false,
                activeModules: { opermaq: true, stockpile: false },
                permissions: {
                    opermaq: {
                        canInspect: true,
                        canManageFleet: true,
                        canViewVaults: true,
                        canCurateAI: false,
                    },
                    stockpile: {
                        canScan: true,
                        canCalculate: true,
                        canExportReport: true,
                        canTrainVisionAI: false,
                    },
                    pilot: {
                        canCommentAndRequestChanges: false,
                        canSimulateProjects: false,
                        canTrainInternalAI: false,
                    },
                },
            },
            hasDevGatewayToken: true,
        });
        expect(b2bCaps.canCurateAI).toBe(false);
        expect(resolveEffectiveOpermaqDomain('CATALOG', b2bCaps)).toBe('FLEET');
        expect(resolveEffectiveOpermaqDomain('FLEET', b2bCaps)).toBe('FLEET');
        expect(resolveEffectiveOpermaqDomain('SYMBOLOGY', b2bCaps)).toBe('SYMBOLOGY');
    });

    it('proyecta esquemas auto-descriptivos exclusivos por TIPO (Motoniveladora, Compresor, Camioneta, Perforadora Manual y tipos aprendidos como Chancador) sin contaminar parámetros cruzados', () => {
        // 1. MOTONIVELADORA (comparación 1 a 1 entre CAT 140M y KOMATSU GD655-5 sobre el mismo esquema de TIPO)
        const cat140m = buildEquipmentShortDescription({
            equipment_type_key: 'motoniveladora',
            tipo_equipo: 'MOTONIVELADORA',
            canonical_specs: [
                {
                    axis_key: 'potencia_neta_vhp',
                    label_es: 'Potencia neta',
                    value_si: '136 kW (183 HP)',
                    unit_si: 'kW (HP)',
                    mandatory: true,
                    is_differentiator: true,
                    value_kind: 'PHYSICAL_MAGNITUDE',
                },
                {
                    axis_key: 'ancho_vertedera',
                    label_es: 'Vertedera',
                    value_si: '3.700 mm',
                    unit_si: 'mm',
                    mandatory: true,
                    is_differentiator: true,
                    value_kind: 'PHYSICAL_MAGNITUDE',
                },
                {
                    axis_key: 'traccion_hoja',
                    label_es: 'Tracción hoja',
                    value_si: '105,1 kN',
                    unit_si: 'kN / kg',
                    mandatory: true,
                    is_differentiator: true,
                    value_kind: 'PHYSICAL_MAGNITUDE',
                },
                {
                    axis_key: 'peso_operativo',
                    label_es: 'Peso operativo',
                    value_si: '15.130 kg',
                    unit_si: 'kg',
                    mandatory: true,
                    is_differentiator: false,
                    value_kind: 'PHYSICAL_MAGNITUDE',
                },
            ],
        });

        const komatsuGd655 = buildEquipmentShortDescription({
            equipment_type_key: 'motoniveladora',
            tipo_equipo: 'MOTONIVELADORA',
            canonical_specs: [
                {
                    axis_key: 'potencia_neta_vhp',
                    label_es: 'Potencia neta',
                    value_si: '163 kW (218 HP)',
                    unit_si: 'kW (HP)',
                    mandatory: true,
                    is_differentiator: true,
                    value_kind: 'PHYSICAL_MAGNITUDE',
                },
                {
                    axis_key: 'ancho_vertedera',
                    label_es: 'Vertedera',
                    value_si: '3.710 mm',
                    unit_si: 'mm',
                    mandatory: true,
                    is_differentiator: true,
                    value_kind: 'PHYSICAL_MAGNITUDE',
                },
                {
                    axis_key: 'traccion_hoja',
                    label_es: 'Tracción hoja',
                    value_si: null,
                    unit_si: 'kN / kg',
                    mandatory: true,
                    is_differentiator: true,
                    value_kind: 'PHYSICAL_MAGNITUDE',
                },
                {
                    axis_key: 'peso_operativo',
                    label_es: 'Peso operativo',
                    value_si: '16.595 kg',
                    unit_si: 'kg',
                    mandatory: true,
                    is_differentiator: false,
                    value_kind: 'PHYSICAL_MAGNITUDE',
                },
            ],
        });

        expect(cat140m).toBe(
            'Potencia neta: 136 kW (183 HP) · Vertedera: 3.700 mm · Tracción hoja: 105,1 kN · Peso operativo: 15.130 kg'
        );
        expect(komatsuGd655).toBe(
            `Potencia neta: 163 kW (218 HP) · Vertedera: 3.710 mm · Tracción hoja: ${MISSING_AXIS_VALUE} · Peso operativo: 16.595 kg`
        );

        // 2. COMPRESOR DE AIRE: Cero "capacidad de balde", solo caudal, presión y potencia
        const compressor = buildEquipmentShortDescription({
            equipment_type_key: 'compresor_aire',
            tipo_equipo: 'COMPRESOR DE AIRE',
            canonical_specs: [
                {
                    axis_key: 'caudal_aire_fad',
                    label_es: 'Caudal aire libre',
                    value_si: '5,3 m³/min (185 CFM)',
                    unit_si: 'm³/min (L/s)',
                    mandatory: true,
                    is_differentiator: true,
                    value_kind: 'PHYSICAL_MAGNITUDE',
                },
                {
                    axis_key: 'presion_trabajo_nominal',
                    label_es: 'Presión trabajo',
                    value_si: '7 bar (100 psi)',
                    unit_si: 'bar (psi)',
                    mandatory: true,
                    is_differentiator: true,
                    value_kind: 'PHYSICAL_MAGNITUDE',
                },
                {
                    axis_key: 'potencia_motor',
                    label_es: 'Potencia motor',
                    value_si: '36 kW (49 HP)',
                    unit_si: 'kW (HP)',
                    mandatory: true,
                    is_differentiator: false,
                    value_kind: 'PHYSICAL_MAGNITUDE',
                },
            ],
        });
        expect(compressor).toBe(
            'Caudal aire libre: 5,3 m³/min (185 CFM) · Presión trabajo: 7 bar (100 psi) · Potencia motor: 36 kW (49 HP)'
        );
        expect(compressor.toLowerCase()).not.toContain('balde');

        // 3. TIPO INÉDITO AUTO-APRENDIDO ("CHANCADOR DE MANDÍBULAS") sin tocar ningún switch estático en frontend
        const learnedCrusherSchema = GlobalEquipmentTypeSchema.safeParse({
            type_key: 'chancador_de_mandibulas',
            canonical_type_es: 'CHANCADOR DE MANDÍBULAS',
            categoria_equipo: 'CONMINUCIÓN Y CHANCADO',
            type_aliases: ['chancador de mandibulas', 'trituradora de mandibulas'],
            search_tokens: ['chancador', 'mandibulas', 'conminucion'],
            spec_schema: [
                {
                    axis_key: 'boca_alimentacion',
                    label_es: 'Boca alimentación',
                    unit_si: 'mm',
                    value_kind: 'PHYSICAL_MAGNITUDE',
                    search_keywords: ['feed opening', 'boca de alimentación', 'mm'],
                    mandatory: true,
                    is_differentiator: true,
                },
                {
                    axis_key: 'rango_css',
                    label_es: 'Rango CSS',
                    unit_si: 'mm',
                    value_kind: 'PHYSICAL_MAGNITUDE',
                    search_keywords: ['closed side setting', 'CSS', 'mm'],
                    mandatory: true,
                    is_differentiator: true,
                },
                {
                    axis_key: 'capacidad_produccion',
                    label_es: 'Capacidad producción',
                    unit_si: 't/h',
                    value_kind: 'PHYSICAL_MAGNITUDE',
                    search_keywords: ['capacity', 'capacidad', 't/h'],
                    mandatory: true,
                    is_differentiator: true,
                },
            ],
            schema_version: 1,
            origin: 'AI_DISCOVERED',
            is_human_locked: false,
            usage_count: 2,
            created_at: '2026-11-06T01:00:00.000Z',
            updated_at: '2026-11-06T01:00:00.000Z',
        });
        expect(learnedCrusherSchema.success).toBe(true);

        const metsoC120 = buildEquipmentShortDescription({
            equipment_type_key: 'chancador_de_mandibulas',
            tipo_equipo: 'CHANCADOR DE MANDÍBULAS',
            canonical_specs: [
                {
                    axis_key: 'boca_alimentacion',
                    label_es: 'Boca alimentación',
                    value_si: '1.200 x 870 mm',
                    unit_si: 'mm',
                    mandatory: true,
                    is_differentiator: true,
                    value_kind: 'PHYSICAL_MAGNITUDE',
                },
                {
                    axis_key: 'rango_css',
                    label_es: 'Rango CSS',
                    value_si: '70 - 200 mm',
                    unit_si: 'mm',
                    mandatory: true,
                    is_differentiator: true,
                    value_kind: 'PHYSICAL_MAGNITUDE',
                },
                {
                    axis_key: 'capacidad_produccion',
                    label_es: 'Capacidad producción',
                    value_si: '575 t/h',
                    unit_si: 't/h',
                    mandatory: true,
                    is_differentiator: true,
                    value_kind: 'PHYSICAL_MAGNITUDE',
                },
            ],
        });
        expect(metsoC120).toBe(
            'Boca alimentación: 1.200 x 870 mm · Rango CSS: 70 - 200 mm · Capacidad producción: 575 t/h'
        );
    });

    it('homologa y normaliza la Matriz Energética, Consumos y Autonomía en los arquetipos y contratos Zod v2', () => {
        const caexAxes = ARCHETYPE_DEFINITIONS.CAMION_TOLVA_CAEX.axes;
        const energySourceAxis = caexAxes.find((a) => a.axis_key === 'fuente_energia');
        const consumptionAxis = caexAxes.find((a) => a.axis_key === 'consumo_energetico_nominal' || a.axis_key === 'consumo_nominal_o_tasa');
        const capacityAxis = caexAxes.find((a) => a.axis_key === 'capacidad_energetica_autonomia' || a.axis_key === 'capacidad_estanque_o_bateria');

        expect(energySourceAxis).toBeDefined();
        expect(consumptionAxis).toBeDefined();
        expect(capacityAxis).toBeDefined();

        // Normalización canónica de enums de combustible y energía
        expect(cleanCanonicalAxisValue('Turbodiésel Ultra Bajo Azufre', energySourceAxis)).toBe('Diésel');
        expect(cleanCanonicalAxisValue('Dual-fuel diesel gas natural', energySourceAxis)).toBe('Dual-Fuel Diésel-Gas');
        expect(cleanCanonicalAxisValue('100% Electric BEV Battery', energySourceAxis)).toBe('Eléctrico Batería (BEV)');

        // Validación de consumos SI
        expect(cleanCanonicalAxisValue('28.5 L/h', consumptionAxis)).toBe('28.5 L/h');
        expect(cleanCanonicalAxisValue('2.4 km/L', consumptionAxis)).toBe('2.4 km/L');
        expect(cleanCanonicalAxisValue('378 L', capacityAxis)).toBe('378 L');

        // Validación de contrato Zod v2 para GlobalEquipmentTypeDoc
        const typeV2 = GlobalEquipmentTypeSchema.safeParse({
            type_key: 'camion_tolva',
            canonical_type_es: 'CAMIÓN TOLVA',
            categoria_equipo: 'TRANSPORTE PESADO Y MOVIMIENTO DE TIERRA',
            archetype_id: 'CAMION_TOLVA_CAEX',
            type_aliases: ['camion tolva', 'volquete', 'dumper'],
            search_tokens: ['camion', 'tolva', 'volquete'],
            spec_schema: [
                {
                    axis_key: 'carga_util_nominal',
                    label_es: 'Carga útil',
                    unit_si: 't',
                    value_kind: 'PHYSICAL_MAGNITUDE',
                    search_keywords: ['carga útil', 'payload'],
                    mandatory: true,
                    is_differentiator: true,
                },
                {
                    axis_key: 'fuente_energia',
                    label_es: 'Fuente de energía',
                    unit_si: 'Diésel | Eléctrico | Híbrido',
                    value_kind: 'CLOSED_ENUM',
                    allowed_enum_values: ['Diésel', 'Eléctrico Red AC', 'Eléctrico Batería (BEV)', 'Híbrido Diésel-Eléctrico'],
                    search_keywords: ['combustible', 'energia'],
                    mandatory: true,
                    is_differentiator: true,
                },
                {
                    axis_key: 'consumo_nominal_o_tasa',
                    label_es: 'Consumo nominal',
                    unit_si: 'L/h (km/L)',
                    value_kind: 'PHYSICAL_MAGNITUDE',
                    search_keywords: ['consumo', 'l/h', 'km/l'],
                    mandatory: true,
                    is_differentiator: false,
                },
                {
                    axis_key: 'capacidad_estanque_o_bateria',
                    label_es: 'Capacidad estanque',
                    unit_si: 'L',
                    value_kind: 'PHYSICAL_MAGNITUDE',
                    search_keywords: ['estanque', 'capacidad'],
                    mandatory: true,
                    is_differentiator: false,
                },
            ],
            schema_version: 2,
            origin: 'SEEDED_ISO_BASE',
            is_human_locked: false,
            usage_count: 5,
            created_at: '2026-11-09T00:00:00.000Z',
            updated_at: '2026-11-09T00:00:00.000Z',
        });
        expect(typeV2.success).toBe(true);
    });
});

