import type {
    AssetConfigurationProfile,
    AssetMobilityTrait,
    AssetPhysicalTraits,
    CanonicalSpecSlot,
    CostDriverUnit,
    CostMatrixTaxonomyMeta,
    DisambiguationFacetGroup,
    DisambiguationFacetKey,
    DutyTravelRegimeTrait,
    EnergyConsumptionProfile,
    EnergySourceCategory,
    EphemeralIdentificationImageInput,
    EquipmentAxisValueKind,
    FleetIdentifierType,
    FleetOwnershipCondition,
    FunctionalDomainTrait,
    OperationalCostMatrix,
    OperatorInterfaceTrait,
    OpticalIdentificationSummary,
    PmCadenceBasisTrait,
    TransmissionCategory,
} from '../../../contracts/opermaq.contracts';
import {
    ApplyCatalogHomologationBodySchema,
    AssetConfigurationProfileSchema,
    AssetMobilityTraitSchema,
    AssetPhysicalTraitsSchema,
    CanonicalSpecSlotSchema,
    CostDriverUnitSchema,
    CostMatrixTaxonomyMetaSchema,
    DisambiguationFacetGroupSchema,
    DisambiguationFacetKeySchema,
    DutyTravelRegimeTraitSchema,
    EnergyConsumptionProfileSchema,
    EnergySourceCategorySchema,
    EphemeralIdentificationImageInputSchema,
    EquipmentAxisValueKindSchema,
    EquipmentTypeAxisSchema,
    FleetIdentifierTypeSchema,
    FleetOwnershipConditionSchema,
    FleetUnitRegistrationBodySchema,
    FunctionalDomainTraitSchema,
    GlobalEquipmentTypeSchema,
    HITL_CONFIRM_KEYWORD,
    OperationalCostMatrixSchema,
    OperatorInterfaceTraitSchema,
    OpticalIdentificationSummarySchema,
    PmCadenceBasisTraitSchema,
    ResolveAssetBodySchema,
    ReviewContributionBodySchema,
    TransmissionCategorySchema,
} from '../../../contracts/opermaq.contracts';
import type {
    EquipmentTypeAxisSchemaItem,
    MachineryArchetypeId,
} from '../utils/canonicalArchetypeSpecs';

export type {
    AssetConfigurationProfile,
    AssetMobilityTrait,
    AssetPhysicalTraits,
    CanonicalSpecSlot,
    CostDriverUnit,
    CostMatrixTaxonomyMeta,
    DisambiguationFacetGroup,
    DisambiguationFacetKey,
    DutyTravelRegimeTrait,
    EnergyConsumptionProfile,
    EnergySourceCategory,
    EphemeralIdentificationImageInput,
    EquipmentAxisValueKind,
    EquipmentTypeAxisSchemaItem,
    FleetIdentifierType,
    FleetOwnershipCondition,
    FunctionalDomainTrait,
    MachineryArchetypeId,
    OperationalCostMatrix,
    OperatorInterfaceTrait,
    OpticalIdentificationSummary,
    PmCadenceBasisTrait,
    TransmissionCategory,
};

export {
    ApplyCatalogHomologationBodySchema,
    AssetConfigurationProfileSchema,
    AssetMobilityTraitSchema,
    AssetPhysicalTraitsSchema,
    CanonicalSpecSlotSchema,
    CostDriverUnitSchema,
    CostMatrixTaxonomyMetaSchema,
    DisambiguationFacetGroupSchema,
    DisambiguationFacetKeySchema,
    DutyTravelRegimeTraitSchema,
    EnergyConsumptionProfileSchema,
    EnergySourceCategorySchema,
    EphemeralIdentificationImageInputSchema,
    EquipmentAxisValueKindSchema,
    EquipmentTypeAxisSchema,
    FleetIdentifierTypeSchema,
    FleetOwnershipConditionSchema,
    FleetUnitRegistrationBodySchema,
    FunctionalDomainTraitSchema,
    GlobalEquipmentTypeSchema,
    HITL_CONFIRM_KEYWORD,
    OperationalCostMatrixSchema,
    OperatorInterfaceTraitSchema,
    OpticalIdentificationSummarySchema,
    PmCadenceBasisTraitSchema,
    ResolveAssetBodySchema,
    ReviewContributionBodySchema,
    TransmissionCategorySchema,
};

export type EquipmentTypeOrigin = 'SEEDED_ISO_BASE' | 'AI_CURATED' | 'AI_DISCOVERED' | 'HUMAN_CURATED_HITL';

export interface EquipmentTypeCoreChapterItem {
    chapter_key: string;
    title_es: string;
    section_es: string;
    rationale_es: string;
    priority: 'CRÍTICO' | 'IMPORTANTE' | 'COMPLEMENTARIO';
}

export interface EquipmentTypeConditionalSubsystemItem {
    subsystem_key: string;
    title_es: string;
    section_es: string;
    rationale_es: string;
    trigger_keywords: string[];
    activation_rule: 'EVIDENCE_PRESENT';
    discovered_from_model?: string;
    discovered_at?: string;
}

export interface EquipmentTypePillarBlueprint {
    core_chapters: EquipmentTypeCoreChapterItem[];
    conditional_subsystems: EquipmentTypeConditionalSubsystemItem[];
    updated_at?: string;
}

export interface GlobalEquipmentTypeDoc {
    type_key: string;
    canonical_type_es: string;
    categoria_equipo: string;
    archetype_id?: MachineryArchetypeId;
    physical_traits?: AssetPhysicalTraits;
    cost_schema_blueprint?: CostMatrixTaxonomyMeta;
    symbology_concept_ids?: string[];
    type_aliases: string[];
    search_tokens: string[];
    embedding_768_raw?: number[];
    spec_schema: EquipmentTypeAxisSchemaItem[];
    pillar_blueprints?: Partial<Record<PillarId, EquipmentTypePillarBlueprint>>;
    schema_version: number;
    origin: EquipmentTypeOrigin;
    is_human_locked: boolean;
    usage_count: number;
    created_at: string;
    updated_at: string;
}

export type PillarId =
    | 'ficha_tecnica'
    | 'manual_operaciones'
    | 'pauta_mantencion'
    | 'matriz_riesgos'
    | 'checklist_pre_op';

export const VALID_PILLAR_IDS: PillarId[] = [
    'ficha_tecnica',
    'manual_operaciones',
    'pauta_mantencion',
    'matriz_riesgos',
    'checklist_pre_op',
];

export const SEQUENTIAL_PILLAR_ORDER: PillarId[] = [
    'ficha_tecnica',
    'manual_operaciones',
    'pauta_mantencion',
    'matriz_riesgos',
    'checklist_pre_op',
];

export const PILLAR_PREREQUISITE_MAP: Record<PillarId, PillarId | null> = {
    ficha_tecnica: null,
    manual_operaciones: 'ficha_tecnica',
    pauta_mantencion: 'manual_operaciones',
    matriz_riesgos: 'pauta_mantencion',
    checklist_pre_op: 'matriz_riesgos',
};

export type SourceCategory = 'OEM' | 'EXTERNO' | 'YOUTUBE' | 'MANUAL';

export interface ItemizedSource {
    type: SourceCategory;
    author: string;
    description: string;
    url: string;
}

export type EstadoAprobacion = 'GENERADO_IA' | 'REQUIERE_CAMBIOS' | 'APROBADO_HUMANO';

export type HuntIntent = 'INITIAL_CAPTURE' | 'INCREMENTAL_UPDATE';

export interface FigureCallout {
    callout: string;
    component_es: string;
    function_or_spec?: string;
    box_2d?: [number, number, number, number];
}

export interface ExtractedFigureRef {
    figure_id: string;
    sha256: string;
    phash_hex?: string;
    storage_url: string;
    mime_type: 'image/webp' | 'image/svg+xml' | 'image/png';
    figure_type:
        | 'DIAGRAMA_ACOTADO'
        | 'CURVA_RENDIMIENTO'
        | 'ESQUEMA_HIDRAULICO_ELECTRICO'
        | 'FOTO_COMPONENTE'
        | 'MAPA_LUBRICACION_PM'
        | 'SIMBOLOGIA_SEGURIDAD'
        | 'PLANO_VECTORIAL_SVG';
    title_es: string;
    caption_es?: string;
    source_page?: number;
    source_doc_hash?: string;
    source_url?: string;
    box_2d?: [number, number, number, number];
    width?: number;
    height?: number;
    original_bytes?: number;
    optimized_bytes?: number;
    savings_pct?: number;
    callouts?: FigureCallout[];
    is_parametric_svg?: boolean;
}

export interface LockedItemAdvisory {
    advisory_id: string;
    detected_at: string;
    source_label: string;
    source_url?: string;
    summary: string;
    proposed_value: string;
    current_locked_snapshot?: string;
    acknowledged?: boolean;
    acknowledged_by?: string;
    acknowledged_at?: string;
    kind?: 'CONTENT' | 'PENDING_FIGURE';
    figure?: ExtractedFigureRef;
    pending_marker_line?: string;
}

export interface ProposedUpdate {
    proposal_id: string;
    estado_fusion: 'NUEVO' | 'CONFLICTO';
    zona: string;
    componente: string;
    condicion_esperada?: string;
    tipo_input?: 'NUMERIC' | 'BOOLEAN' | 'WARNING' | 'text_block';
    is_oem?: boolean;
    valor_actual?: string;
    valor_nuevo?: string;
    detected_at?: string;
    synthesis?: string;
    human_decision?: 'APROBADO' | 'ELIMINADO' | null;
    decided_at?: string;
    decided_by?: string;
    source_url?: string;
    authorized_at?: string;
    authorized_by?: string;
    status?: string;
    fact_fingerprint?: string;
    figures?: ExtractedFigureRef[];
}

export interface HistorialAuditoria {
    fecha: string;
    accion: string;
    actor: string;
    detalle?: string;
    snapshot_anterior?: string | null;
    revision_id?: string;
    changed_fields?: string[];
}

export interface PillarItem {
    item_id: string;
    order: number;
    title: string;
    section: string;
    rationale: string;
    standard?: string;
    priority: 'CRÍTICO' | 'IMPORTANTE' | 'COMPLEMENTARIO';
    content_status: 'PENDIENTE' | 'GENERANDO' | 'COMPLETADO' | 'ERROR';
    content: string | null;
    created_at: string;
    created_by?: string;
    initial_hunt_activated_at?: string | null;
    hunted_at?: string | null;
    item_sources?: ItemizedSource[];
    hunt_error?: string | null;
    is_discarded?: boolean;
    discarded_by?: string;
    discarded_at?: string;
    reactivated_at?: string;
    estado_aprobacion?: EstadoAprobacion;
    review_notes?: string;
    approved_by?: string;
    approved_at?: string;
    is_human_locked?: boolean;
    historial_cambios?: HistorialAuditoria[];
    pending_conflicts?: ProposedUpdate[];
    authorized_delta_buffer?: ProposedUpdate[];
    locked_item_advisories?: LockedItemAdvisory[];
    figures?: ExtractedFigureRef[];
    fact_fingerprints?: string[];
    rejected_fact_fingerprints?: string[];
    symbology_refs?: string[];
    media_harvest_report?: Record<string, any>;
    last_edit_by?: string;
}

export interface PillarDocument {
    pillar_id: PillarId;
    status: 'IDLE' | 'GENERATING' | 'COMPLETED' | 'ERROR';
    content: string;
    make_model: string;
    generated_at: string | null;
    classified_sources: {
        fabricante: Array<{ dato_aportado?: string; url_limpia?: string; url?: string; title?: string }>;
        externos: Array<{ dato_aportado?: string; url_limpia?: string; url?: string; title?: string }>;
        youtube: Array<{ dato_aportado?: string; url_limpia?: string; url?: string; title?: string }>;
    };
    error_message?: string | null;
    disclaimer?: string;
    updated_at?: string | null;
    items: PillarItem[];
    classified_sources_itemized?: ItemizedSource[];
    suggested_items_pending?: Array<{
        title: string;
        rationale: string;
        section: string;
        source?: ItemizedSource;
    }>;
    itemize_status: 'IDLE' | 'GENERATING' | 'PARTIAL_FROM_INGESTION' | 'COMPLETED' | 'ERROR';
    started_at?: string | null;
    itemized_at?: string | null;
    itemize_error?: string | null;
    structure_digest_sha256?: string | null;
    content_digest_sha256?: string | null;
    parent_pillar_digest_sha256?: string | null;
    indices?: Record<string, any>;
}

export type KnowledgeVault = Record<PillarId, PillarDocument> & {
    is_sealed?: boolean;
    sealed_at?: string | null;
    sealed_by?: string | null;
    unseal_reason?: string | null;
    vault_merkle_root_sha256?: string | null;
};

export interface MasterSymbologyVariant {
    verified_by_human: boolean;
    verified_by?: string;
    verified_at?: string;
    asset_storage_url?: string;
    temp_storage_url?: string;
    style_notes?: string;
}

export interface MasterSymbologyItem {
    concept_id: string;
    iso_reference: string;
    technical_name_es: string;
    technical_name_en: string;
    description_es: string;
    description_en: string;
    critical_color: 'RED' | 'AMBER' | 'GREEN' | 'BLUE' | 'NONE' | string;
    standard_icon_status:
        | 'pendiente_busqueda'
        | 'pendiente_confirmacion_humana'
        | 'pendiente_dibujo_humano'
        | 'encontrado';
    standard_icon_url?: string;
    temp_standard_icon_url?: string;
    temp_icon_candidates?: Array<{ url: string; source_filename: string }>;
    brands_variants: Record<string, MasterSymbologyVariant>;
    insertion_point_hint?: string;
    referenced_by_items?: string[];
    created_at: string;
    created_by: string;
    updated_at?: string;
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'model';
    content: string;
    timestamp: string;
    highlightText?: string;
    draftContent?: string;
    draftStatus?: 'PENDING' | 'APPLIED' | 'DISCARDED';
    appliedAt?: string;
    discardedAt?: string;
    selectedFragmentTarget?: string;
    intent?: 'CHAT' | 'EDIT_PROPOSAL' | 'RESEARCH_WEB' | 'SEARCH_IMAGE';
}

export interface CatalogProfile {
    equipment_type_key?: string;
    archetype_id?: MachineryArchetypeId;
    physical_traits?: AssetPhysicalTraits;
    configuration_profile?: AssetConfigurationProfile;
    tipo_equipo: string;
    categoria_equipo: string;
    canonical_specs?: CanonicalSpecSlot[];
    energy_consumption_profile?: EnergyConsumptionProfile;
    ambiente_operativo: string[];
    contexto_operativo: string[];
    caracteristicas_principales: string[];
    grounded_sources?: string[];
}

export interface ResolvedAssetCandidate {
    global_asset_id?: string;
    existing_catalog_id?: string | null;
    catalog_key?: string;
    make_oficial: string;
    model_oficial: string;
    equipment_type_key?: string;
    archetype_id?: MachineryArchetypeId;
    physical_traits?: AssetPhysicalTraits;
    configuration_profile?: AssetConfigurationProfile;
    tipo_equipo: string;
    categoria_equipo: string;
    canonical_specs?: CanonicalSpecSlot[];
    energy_consumption_profile?: EnergyConsumptionProfile;
    ambiente_operativo: string[];
    contexto_operativo: string[];
    caracteristicas_principales: string[];
    versions?: string[];
    chassis_versions?: string[];
    official_url?: string;
    isNew: boolean;
    is_pertinent?: boolean;
    rejection_reason?: string;
    requires_clarification?: boolean;
    clarification_message?: string;
    disambiguation_facets?: DisambiguationFacetGroup[];
    optical_identification_summary?: OpticalIdentificationSummary | null;
}

export interface ResolveAssetsEnvelopeResponse {
    candidates: ResolvedAssetCandidate[];
    optical_identification_summary?: OpticalIdentificationSummary | null;
    disambiguation_facets?: DisambiguationFacetGroup[];
}

export type SymbologyStandardFamily =
    | 'ISO_7010'
    | 'ISO_7000'
    | 'ISO_2575'
    | 'IEC_60417'
    | 'GHS'
    | 'OEM_CUSTOM';

export type SymbologyFunctionalGroup =
    | 'MANDATORY_PPE'
    | 'HAZARD_PROHIBITION'
    | 'CABIN_TELLTALES_CONTROLS'
    | 'MAINTENANCE_FLUIDS_ELECTRICAL';

export interface SymbologyChapterApplicationRef {
    pillar_id: PillarId;
    pillar_label: string;
    item_id: string;
    item_title: string;
    context_excerpt: string;
}

export interface SymbologyPackEntry {
    concept_id: string;
    standard_family: SymbologyStandardFamily;
    iso_reference: string;
    group: SymbologyFunctionalGroup;
    technical_name_es: string;
    action_operator_es: string;
    equipment_specific_application_es?: string;
    applied_in_pillars?: string[];
    applied_in_chapters?: SymbologyChapterApplicationRef[];
    critical_color: 'RED' | 'AMBER' | 'GREEN' | 'BLUE' | 'NONE' | string;
    icon_url: string;
    svg_inline?: string;
    is_brand_specific?: boolean;
    original_bytes?: number;
    optimized_bytes?: number;
    savings_pct?: number;
    source_layer: 'ARCHETYPE' | 'POWERTRAIN_TECH' | 'TENANT_FAENA' | 'OEM_MANUAL';
}

export interface EquipmentSymbologyPack {
    generated_at: string;
    archetype_key: string;
    powertrain_tags: string[];
    total_symbols: number;
    compiled_entries?: SymbologyPackEntry[];
    groups: Record<SymbologyFunctionalGroup, SymbologyPackEntry[]>;
}

export type AdHocManualProfileId =
    | 'MASTER_5_PILLARS'
    | 'OPERATOR_POCKET_GUIDE'
    | 'WORKSHOP_PM_MANUAL'
    | 'REGULATORY_DS132_LOTO';

export interface QuarantineProposedPillarDelta {
    proposal_id: string;
    pillar_id: PillarId;
    chapter_title: string;
    section: string;
    priority: 'CRÍTICO' | 'IMPORTANTE' | 'COMPLEMENTARIO';
    current_published_title?: string | null;
    current_published_excerpt?: string | null;
    suggested_markdown: string;
    structured_deltas?: Array<{
        zona: string;
        componente: string;
        valor_actual?: string;
        valor_nuevo: string;
        condicion_esperada?: string;
    }>;
    figures?: ExtractedFigureRef[];
    source_pages: number[];
    fact_fingerprint: string;
}
