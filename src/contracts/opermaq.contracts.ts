import { z } from 'zod';

/**
 * MINREPORT OPERMAQ v3.0 — Contratos Canónicos Universales y Ontología Polimórfica por Rasgos
 *
 * Fuente única de esquemas Zod compartida con `web/src/contracts/index.ts`.
 * Soporta cualquier activo industrial (maquinaria pesada, vehículos viales/faena, plantas,
 * bombas, grupos electrógenos, soldadoras, torres de iluminación, herramientas hidráulicas/eléctricas,
 * equipos de izaje, perforación, RPAS/drones e instrumentación metrológica) sin modificar código.
 */

export const HITL_CONFIRM_KEYWORD = 'ACTUALIZAR' as const;

export const FleetIdentifierTypeSchema = z.enum([
    'SERIAL_NUMBER',
    'LICENSE_PLATE',
    'VIN',
    'ASSET_TAG',
]);

export type FleetIdentifierType = z.infer<typeof FleetIdentifierTypeSchema>;

export const FleetOwnershipConditionSchema = z.enum([
    'PROPIO',
    'ARRENDADO',
    'CONTRATISTA',
    'COMODATO',
]);

export type FleetOwnershipCondition = z.infer<typeof FleetOwnershipConditionSchema>;

export const EquipmentAxisValueKindSchema = z.enum(['PHYSICAL_MAGNITUDE', 'CLOSED_ENUM']);
export type EquipmentAxisValueKind = z.infer<typeof EquipmentAxisValueKindSchema>;

export const EquipmentTypeAxisSchema = z.object({
    axis_key: z.string().trim().min(1).max(64),
    label_es: z.string().trim().min(1).max(64),
    unit_si: z.string().trim().min(1).max(64),
    value_kind: EquipmentAxisValueKindSchema,
    allowed_enum_values: z.array(z.string().trim().min(1)).optional(),
    search_keywords: z.array(z.string().trim().min(1)).min(1).max(16),
    mandatory: z.boolean().default(true),
    is_differentiator: z.boolean().default(false),
});

export type EquipmentTypeAxis = z.infer<typeof EquipmentTypeAxisSchema>;

export const EnergySourceCategorySchema = z.enum([
    'DIESEL',
    'GASOLINA',
    'ELECTRICO_RED_AC',
    'ELECTRICO_BATERIA_BEV',
    'HIBRIDO_DIESEL_ELECTRICO',
    'HIBRIDO_GASOLINA_ELECTRICO',
    'DUAL_FUEL_DIESEL_GAS',
    'GLP_GNV',
    'NEUMATICO_AIRE_COMPRIMIDO',
    'HIDRAULICO_AUXILIAR',
    'REMOLCADO_SIN_PROPULSION_PROPIA',
    'MANUAL_MECANICO',
    'NO_DECLARADO',
]);

export type EnergySourceCategory = z.infer<typeof EnergySourceCategorySchema>;

export const AssetMobilityTraitSchema = z.enum([
    'SELF_PROPELLED_WHEELED',
    'SELF_PROPELLED_TRACKED',
    'TOWED_TRAILER',
    'RAIL_OR_GANTRY',
    'SKID_STATIONARY',
    'PORTABLE_OR_HANDHELD',
    'AERIAL_OR_MARINE',
    'ATTACHMENT_IMPLEMENT',
]);
export type AssetMobilityTrait = z.infer<typeof AssetMobilityTraitSchema>;

export const OperatorInterfaceTraitSchema = z.enum([
    'ENCLOSED_CABIN_ROPS_FOPS',
    'HIGHWAY_CABIN',
    'OPEN_CANOPY_OR_SEAT',
    'WALK_BEHIND_OR_PENDANT',
    'REMOTE_RADIO_OR_GCS',
    'LOCAL_PANEL_HMI',
    'DIRECT_HAND_TRIGGER',
]);
export type OperatorInterfaceTrait = z.infer<typeof OperatorInterfaceTraitSchema>;

export const DutyTravelRegimeTraitSchema = z.enum([
    'OFF_ROAD_SITE',
    'ON_HIGHWAY',
    'DUAL_ROAD_AND_SITE',
    'STATIONARY_DUTY',
    'FLIGHT_OR_MISSION',
]);
export type DutyTravelRegimeTrait = z.infer<typeof DutyTravelRegimeTraitSchema>;

export const PmCadenceBasisTraitSchema = z.enum([
    'HOROMETER_HOURS',
    'ODOMETER_KM',
    'DUAL_KM_AND_HOURS',
    'CYCLES_OR_FLIGHTS',
    'CALENDAR_AND_METROLOGY',
]);
export type PmCadenceBasisTrait = z.infer<typeof PmCadenceBasisTraitSchema>;

export const FunctionalDomainTraitSchema = z.enum([
    'EARTHMOVING_EXCAVATION',
    'HAULAGE_AND_TRANSPORT',
    'LIFTING_AND_RIGGING',
    'DRILLING_AND_GROUND_SUPPORT',
    'COMMINUTION_AND_SCREENING',
    'FLUID_PUMPING_AND_AIR',
    'POWER_GEN_WELDING_LIGHTING',
    'BOLTING_TORQUE_AND_TOOLS',
    'SURVEY_INSPECTION_RPAS',
    'VOCATIONAL_SERVICE_SUPPORT',
    'SURFACE_MILLING_COMPACTION',
    'INDUSTRIAL_GENERAL',
]);
export type FunctionalDomainTrait = z.infer<typeof FunctionalDomainTraitSchema>;

export const AssetPhysicalTraitsSchema = z.object({
    mobility: AssetMobilityTraitSchema.default('SKID_STATIONARY'),
    primary_energy: EnergySourceCategorySchema.default('NO_DECLARADO'),
    operator_interface: OperatorInterfaceTraitSchema.default('LOCAL_PANEL_HMI'),
    duty_travel_regime: DutyTravelRegimeTraitSchema.default('OFF_ROAD_SITE'),
    pm_cadence_basis: PmCadenceBasisTraitSchema.default('HOROMETER_HOURS'),
    functional_domain: FunctionalDomainTraitSchema.default('INDUSTRIAL_GENERAL'),
    has_hydraulic_system: z.boolean().default(false),
    has_compressed_air_system: z.boolean().default(false),
    requires_metrology_calibration: z.boolean().default(false),
    iso_14224_equipment_class: z.string().trim().max(32).default('IND-GEN'),
    unspsc_code: z.string().trim().max(16).optional(),
    material_symbol_icon: z.string().trim().max(64).default('precision_manufacturing'),
});

export type AssetPhysicalTraits = z.infer<typeof AssetPhysicalTraitsSchema>;

export const CostMatrixTaxonomyMetaSchema = z.object({
    family_key: z.string().default('INDUSTRIAL_GENERAL'),
    family_label_es: z.string().default('Activo Industrial'),
    material_icon: z.string().default('precision_manufacturing'),
    wear_section_visible: z.boolean().default(true),
    wear_section_title_es: z.string().default('Elementos de Desgaste Operacional y Trabajo'),
    wear_col_1_label_es: z.string().default('Elemento / Repuesto de Desgaste'),
    wear_col_2_label_es: z.string().default('Subsistema / Zona de Trabajo'),
    wear_empty_hint_es: z
        .string()
        .default('[Información técnica no declarada en ficha] — Sin elementos de desgaste cazados en Pauta de Mantención.'),
    support_section_visible: z.boolean().default(true),
    support_section_title_es: z.string().default('Sistema de Rodado, Apoyo o Sujeción'),
    support_col_spec_label_es: z.string().default('Medida / Especificación OEM'),
    support_col_pressure_label_es: z.string().default('Presión / Tensión / Precarga Nominal'),
    support_empty_hint_es: z
        .string()
        .default('[Información técnica no declarada en ficha] — Sin componentes de rodado o apoyo cazados en Pauta de Mantención.'),
    supports_road_km_efficiency: z.boolean().default(false),
    supports_hourly_load_table: z.boolean().default(true),
    primary_tco_unit: z
        .enum(['$ / h', '$ / km', '$ / km + $ / h (PTO)', '$ / ciclo', '$ / mes'])
        .default('$ / h'),
    wear_include_keywords: z.array(z.string()).optional(),
    wear_exclude_keywords: z.array(z.string()).optional(),
});

export type CostMatrixTaxonomyMeta = z.infer<typeof CostMatrixTaxonomyMetaSchema>;

export const CostDriverUnitSchema = z.enum([
    'L/h',
    'km/L',
    'L/100km',
    'kWh/h',
    'kWh/100km',
    'kWh/ciclo',
    'L/s',
    'L/min',
    'bar (700 bar Hidr.)',
    '0 L/h (Remolcado)',
    '0 L/h (Manual)',
]);

export type CostDriverUnit = z.infer<typeof CostDriverUnitSchema>;

export const EnergyConsumptionProfileSchema = z.object({
    energy_source: EnergySourceCategorySchema.default('NO_DECLARADO'),
    energy_spec_label: z.string().nullable().default(null),
    cost_driver_unit: CostDriverUnitSchema.default('L/h'),
    hourly_consumption_by_load: z.object({
        idle_or_pto: z.string().nullable().default(null),
        low_load_25_35pct: z.string().nullable().default(null),
        medium_load_50_65pct: z.string().nullable().default(null),
        high_load_80_100pct: z.string().nullable().default(null),
    }),
    road_haul_efficiency: z.object({
        km_per_liter: z.string().nullable().default(null),
        liters_per_100km: z.string().nullable().default(null),
        kwh_per_100km: z.string().nullable().default(null),
        highway_km_per_liter: z.string().nullable().optional().default(null),
        highway_liters_per_100km: z.string().nullable().optional().default(null),
        offroad_km_per_liter: z.string().nullable().optional().default(null),
        offroad_liters_per_100km: z.string().nullable().optional().default(null),
        estimated_range_km: z.string().nullable().optional().default(null),
    }),
    specific_consumption_bsfc_gkwh: z.string().nullable().default(null),
    pneumatic_or_hydraulic_flow: z.string().nullable().default(null),
    def_adblue_consumption: z.object({
        requires_def: z.boolean().default(false),
        consumption_pct_of_fuel: z.string().nullable().default(null),
        tank_capacity_liters: z.string().nullable().default(null),
    }),
    storage_and_autonomy: z.object({
        tank_or_battery_capacity: z.string().nullable().default(null),
        estimated_autonomy: z.string().nullable().default(null),
    }),
    source_url: z.string().nullable().default(null),
    updated_at: z.string(),
});

export type EnergyConsumptionProfile = z.infer<typeof EnergyConsumptionProfileSchema>;

export const OperationalCostMatrixSchema = z.object({
    version: z.string().default('3.0.0'),
    compiled_at: z.string(),
    source_merkle_root_sha256: z.string().nullable().default(null),
    completeness_status: z.enum(['EMPTY', 'PARTIAL', 'COMPLETE']).default('EMPTY'),
    taxonomy_meta: CostMatrixTaxonomyMetaSchema.optional(),
    capex_and_depreciation: z.object({
        reference_new_price_usd: z.string().nullable().default(null),
        reference_new_price_clp: z.string().nullable().default(null),
        price_condition_and_year: z.string().nullable().default(null),
        economic_life_hours: z.string().nullable().default(null),
        economic_life_km: z.string().nullable().default(null),
        economic_life_years: z.string().nullable().default(null),
        residual_value_pct: z.string().nullable().default(null),
        hourly_depreciation_base: z.string().nullable().default(null),
        factory_tire_or_track_equip: z.string().nullable().default(null),
        factory_work_tool_equip: z.string().nullable().default(null),
        source_item_title: z.string().nullable().default(null),
    }),
    energy_consumption: EnergyConsumptionProfileSchema,
    periodic_fluids: z
        .array(
            z.object({
                compartment: z.string(),
                fluid_spec: z.string(),
                viscosity: z.string(),
                capacity_per_change: z.string(),
                interval: z.string(),
                prorated_per_1000h: z.string().nullable().default(null),
                source_item_title: z.string(),
            })
        )
        .default([]),
    periodic_filters_and_seals: z
        .array(
            z.object({
                component_name: z.string(),
                category: z.enum([
                    'FILTRO',
                    'SELLO_EMPAQUETADURA',
                    'CORREA_MANGUERA',
                    'KIT_PM',
                    'RESPIRADERO',
                ]),
                system: z.string(),
                oem_part_number: z.string(),
                quantity_per_change: z.string(),
                interval: z.string(),
                pm_stage: z.string(),
                source_item_title: z.string(),
            })
        )
        .default([]),
    wear_parts_get: z
        .array(
            z.object({
                part_name: z.string(),
                work_tool_zone: z.string(),
                oem_spec_or_code: z.string(),
                installed_qty: z.string(),
                estimated_life: z.string(),
                condemnation_limit: z.string(),
                source_item_title: z.string(),
            })
        )
        .default([]),
    tires_and_undercarriage: z
        .array(
            z.object({
                component_name: z.string(),
                category: z.enum([
                    'NEUMATICO',
                    'ORUGA_GOMA',
                    'ORUGA_ACERO_ZAPATA',
                    'RODILLO_RUEDA_GUIA_SPROCKET',
                    'SOPORTE_ELASTOMERO',
                    'HELICE_ROTOR_TREN_ATERRIZAJE',
                    'CABLE_IZAJE_CARRETE',
                ]),
                size_or_compound_spec: z.string(),
                installed_qty: z.string(),
                nominal_pressure_or_tension: z.string(),
                estimated_life: z.string(),
                condemnation_limit: z.string(),
                source_item_title: z.string(),
            })
        )
        .default([]),
    scheduled_pm_kits_summary: z
        .array(
            z.object({
                pm_code: z.string(),
                interval: z.string(),
                fluids_summary: z.string(),
                filters_and_seals_summary: z.string(),
                wear_and_rodado_checks: z.string(),
            })
        )
        .default([]),
});

export type OperationalCostMatrix = z.infer<typeof OperationalCostMatrixSchema>;

export const GlobalEquipmentTypeSchema = z.object({
    type_key: z.string().trim().min(2).max(80),
    canonical_type_es: z.string().trim().min(2).max(96),
    categoria_equipo: z.string().trim().min(2).max(96),
    archetype_id: z.string().trim().optional(),
    physical_traits: AssetPhysicalTraitsSchema.optional(),
    cost_schema_blueprint: CostMatrixTaxonomyMetaSchema.optional(),
    symbology_concept_ids: z.array(z.string()).optional(),
    type_aliases: z.array(z.string()).default([]),
    search_tokens: z.array(z.string()).default([]),
    spec_schema: z.array(EquipmentTypeAxisSchema).min(2).max(16),
    schema_version: z.number().int().positive().default(8),
    origin: z.enum(['SEEDED_ISO_BASE', 'AI_CURATED', 'AI_DISCOVERED', 'HUMAN_CURATED_HITL']),
    is_human_locked: z.boolean().default(false),
    usage_count: z.number().int().nonnegative().default(0),
    created_at: z.string(),
    updated_at: z.string(),
});

export type GlobalEquipmentType = z.infer<typeof GlobalEquipmentTypeSchema>;

export const CanonicalSpecSlotSchema = z.object({
    axis_key: z.string().trim().min(1),
    label_es: z.string().trim().min(1),
    value_si: z.string().trim().nullable(),
    unit_si: z.string().trim().optional(),
    mandatory: z.boolean().optional(),
    is_differentiator: z.boolean().optional(),
    value_kind: EquipmentAxisValueKindSchema.optional(),
    allowed_enum_values: z.array(z.string().trim().min(1)).optional(),
    source_url: z.string().trim().nullable().optional(),
    verbatim_evidence: z.string().trim().nullable().optional(),
});

export type CanonicalSpecSlot = z.infer<typeof CanonicalSpecSlotSchema>;

export const TransmissionCategorySchema = z.enum([
    'MANUAL_SYNCHRONIZED',
    'MANUAL_UNSYNCHRONIZED_FULLER',
    'AUTOMATED_MANUAL_AMT',
    'AUTOMATIC_PLANETARY_CONVERTER',
    'POWERSHIFT',
    'HYDROSTATIC',
    'ELECTRIC_DRIVE',
    'DIRECT_MECHANICAL',
    'NOT_APPLICABLE',
]);

export type TransmissionCategory = z.infer<typeof TransmissionCategorySchema>;

export const AssetConfigurationProfileSchema = z.object({
    axle_or_undercarriage_config: z.string().trim().max(120).nullable().default(null),
    tire_or_track_count: z.number().int().positive().max(64).nullable().default(null),
    transmission_category: TransmissionCategorySchema.nullable().default(null),
    transmission_model_spec: z.string().trim().max(140).nullable().default(null),
    work_body_or_implement: z.string().trim().max(160).nullable().default(null),
    engine_or_prime_mover_spec: z.string().trim().max(160).nullable().default(null),
    auxiliary_braking_spec: z.string().trim().max(140).nullable().default(null),
    factory_emission_or_grid_spec: z.string().trim().max(140).nullable().default(null),
    identification_source: z
        .enum(['MULTIMODAL_PLATE_AND_PHOTO', 'GROUNDED_OEM_SPEC', 'HUMAN_CURATED'])
        .default('GROUNDED_OEM_SPEC'),
});

export type AssetConfigurationProfile = z.infer<typeof AssetConfigurationProfileSchema>;

export const EphemeralIdentificationImageInputSchema = z.object({
    mimeType: z.enum(['image/webp', 'image/jpeg', 'image/png']),
    base64Data: z.string().min(32).max(2_400_000),
    hintLabel: z.string().trim().max(80).optional(),
});

export type EphemeralIdentificationImageInput = z.infer<typeof EphemeralIdentificationImageInputSchema>;

export const OpticalIdentificationSummarySchema = z.object({
    detected_make: z.string().trim().nullable().default(null),
    detected_model_or_series: z.string().trim().nullable().default(null),
    wmi_vds_structural_code: z.string().trim().nullable().default(null),
    observed_axle_or_undercarriage: z.string().trim().nullable().default(null),
    observed_transmission: z.string().trim().nullable().default(null),
    observed_work_body_or_implement: z.string().trim().nullable().default(null),
    observed_engine_or_rating: z.string().trim().nullable().default(null),
    observed_emission_or_grid: z.string().trim().nullable().default(null),
    evidence_notes_es: z.string().trim().nullable().default(null),
    confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
});

export type OpticalIdentificationSummary = z.infer<typeof OpticalIdentificationSummarySchema>;

export const DisambiguationFacetKeySchema = z.enum([
    'axle_config',
    'transmission',
    'work_body',
    'emission_or_spec_origin',
    'power_grid',
    'model_family',
]);

export type DisambiguationFacetKey = z.infer<typeof DisambiguationFacetKeySchema>;

export const DisambiguationFacetOptionSchema = z.object({
    value: z.string().trim().min(1).max(96),
    label_es: z.string().trim().min(1).max(120),
    candidate_count: z.number().int().nonnegative().optional(),
});

export const DisambiguationFacetGroupSchema = z.object({
    facet_key: DisambiguationFacetKeySchema,
    label_es: z.string().trim().min(1).max(96),
    helper_es: z.string().trim().max(160).optional(),
    options: z.array(DisambiguationFacetOptionSchema).min(2).max(12),
});

export type DisambiguationFacetGroup = z.infer<typeof DisambiguationFacetGroupSchema>;

export const ResolveAssetBodySchema = z.object({
    jerga: z.string().max(320).optional(),
    modelo: z.string().max(160).optional(),
    marca: z.string().max(160).optional(),
    tipo: z.string().max(160).optional(),
    isGeneric: z.boolean().optional().default(false),
    clarificationContext: z.string().max(1600).optional(),
    ephemeralImages: z.array(EphemeralIdentificationImageInputSchema).max(3).optional(),
    includeEnvelope: z.boolean().optional().default(false),
    forceWebDiscovery: z.boolean().optional().default(false),
});

export const FleetUnitRegistrationBodySchema = z.object({
    global_asset_id: z.string().trim().optional(),
    make_oficial: z.string().trim().min(1, 'make_oficial es obligatorio.'),
    model_oficial: z.string().trim().min(1, 'model_oficial es obligatorio.'),
    categoria_equipo: z.string().trim().optional(),
    tipo_equipo: z.string().trim().optional(),
    equipment_type_key: z.string().trim().optional(),
    archetype_id: z.string().trim().optional(),
    physical_traits: AssetPhysicalTraitsSchema.optional(),
    configuration_profile: AssetConfigurationProfileSchema.optional(),
    canonical_specs: z.array(CanonicalSpecSlotSchema).optional(),
    energy_consumption_profile: EnergyConsumptionProfileSchema.optional(),
    ambiente_operativo: z.array(z.string()).optional(),
    contexto_operativo: z.array(z.string()).optional(),
    caracteristicas_principales: z.array(z.string()).optional(),
    chassis_versions: z.array(z.string()).optional(),
    version: z.string().trim().optional().default('ESTÁNDAR'),
    official_url: z.string().trim().optional(),
    original_jargon: z.string().trim().optional(),
    isGeneric: z.boolean().optional().default(false),
    identifier_type: FleetIdentifierTypeSchema.default('SERIAL_NUMBER'),
    identifier_value: z
        .string()
        .trim()
        .min(2, 'Ingrese el Número de Serie, Patente, VIN o Código único de la unidad.')
        .max(80),
    ownership_type: FleetOwnershipConditionSchema.default('PROPIO'),
    horometer: z.number().nonnegative().optional().default(0),
    odometer_km: z.number().nonnegative().optional(),
    cycles_count: z.number().nonnegative().optional(),
    calibration_due_date: z.string().max(32).optional(),
    confirm_word: z.string().trim().min(1),
});

export const ReviewContributionBodySchema = z.object({
    acceptedProposalIds: z.array(z.string()).default([]),
    rejectedProposalIds: z.array(z.string()).default([]),
    reviewNotes: z.string().max(4000).optional(),
    publishApprovedItems: z.boolean().optional().default(true),
    confirmWord: z.string().trim().min(1),
});

export const ApplyCatalogHomologationBodySchema = z.object({
    equipment_type_key: z.string().trim().min(2).optional(),
    archetype_id: z.string().trim().min(1).optional(),
    tipo_equipo: z.string().trim().min(2).optional(),
    categoria_equipo: z.string().trim().min(2).optional(),
    official_url: z.string().trim().optional(),
    physical_traits: AssetPhysicalTraitsSchema.optional(),
    configuration_profile: AssetConfigurationProfileSchema.optional(),
    approved_slots: z.array(CanonicalSpecSlotSchema).min(1),
    energy_consumption_profile: EnergyConsumptionProfileSchema.optional(),
    confirm_word: z.string().trim().min(1),
});

