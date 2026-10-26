/**
 * OPERMAQ 3.0 - Firestore Schema Definitions
 * Estándar: MINREPORT Ecosystem
 * Refactor: R1 (Resolutor), R2 (Flota), R3 (Perfil de Ecosistema)
 *
 * ── ARQUITECTURA 5 PILARES (v7.0) ─────────────────────────────────────────
 *  0 — FICHA TÉCNICA          (especificaciones OEM completas)
 *  I — MANUAL DE OPERACIONES  (parámetros y límites operacionales)
 *  II — PAUTA DE MANTENCIÓN   (intervalos PM y especificaciones de fluidos)
 *  III — MATRIZ DE RIESGOS    (peligros, LOTO, normativa DS132/ISO45001)
 *  IV — CHECKLIST PRE-OP      (walk-around con criterios pasa/no-pasa)
 *  ────────────────────────────────────────────────────────────────────────────
 */

// ─── TIPOS DEL SISTEMA 4 PILARES ─────────────────────────────────────────────

/** Identificadores canónicos de los 5 pilares de la bóveda. */
export type PillarId =
  | 'ficha_tecnica'
  | 'manual_operaciones'
  | 'pauta_mantencion'
  | 'matriz_riesgos'
  | 'checklist_pre_op';

/** Estado de generación del pilar. */
export type PillarStatus = 'IDLE' | 'GENERATING' | 'COMPLETED' | 'ERROR';


/** Fuente técnica clasificada por autoría (FABRICANTE / EXTERNOS / YOUTUBE). */
export interface SourceItem {
  /** Descripción del dato técnico específico que aporta la fuente. */
  dato_aportado?: string;
  /** URL directa del documento o video. */
  url_limpia?: string;
  /** Alias alt para url (compat con clasificador IA). */
  url?: string;
  /** Título de la fuente (alias alt para dato_aportado). */
  title?: string;
}

/**
 * Fuente clasificada por AUTORÍA (no por dominio) para el proceso ITEMIZADO.
 * Categorías: OEM (fabricante), EXTERNO (terceros verificables), YOUTUBE (video técnico).
 */
export interface ItemizedSource {
  /** Tipo de autor intelectual del contenido. */
  type: 'OEM' | 'EXTERNO' | 'YOUTUBE' | 'MANUAL';
  /** Nombre del fabricante, organismo o canal. */
  author: string;
  /** Qué contiene esta fuente y por qué es relevante (1 línea). */
  description: string;
  /** URL real o URL de búsqueda dirigida al recurso. */
  url: string;
}

/**
 * Ítem estructural de un pilar — generado por el proceso ITEMIZADO.
 * Nace sin contenido (content: null) hasta que se ejecuta la CAZA por ítem.
 */
export interface PillarItem {
  /** ID único del ítem (slug del título). */
  item_id: string;
  /** Número de orden dentro del pilar. */
  order: number;
  /** Título técnico del ítem (ej: "Sistema de Frenos de Servicio"). */
  title: string;
  /** Categoría o sección padre (ej: "Sistemas de Seguridad"). */
  section: string;
  /** Por qué este ítem es relevante para el informe de este equipo específico. */
  rationale: string;
  /** Estándar/norma que aplica (DS132, ISO 45001, OEM, etc.). */
  standard?: string;
  /** Prioridad del ítem en el informe. */
  priority: 'CRÍTICO' | 'IMPORTANTE' | 'COMPLEMENTARIO';
  /** Estado del contenido — nace en PENDIENTE. */
  content_status: 'PENDIENTE' | 'GENERANDO' | 'COMPLETADO' | 'ERROR';
  /** Contenido cazado — null hasta ejecutar caza por ítem (Etapa 2). */
  content: string | null;
  /** Timestamp de creación de la estructura. */
  created_at: string;
  /** Email del usuario que creó el ítem manualmente. */
  created_by?: string;

  // ── Campos de CAZA (Etapa 2) — opcionales, retrocompatibles ────────────────
  /** Timestamp de la última caza exitosa de este ítem. */
  hunted_at?: string | null;
  /** Fuentes del ítem clasificadas por autoría (OEM / EXTERNO / YOUTUBE). */
  item_sources?: ItemizedSource[];
  /** Mensaje de error si content_status === 'ERROR'. */
  hunt_error?: string | null;

  // ── Campos de SOFT DELETE (Etapa 5) ──────────────────────────────────────
  /** Si el ítem ha sido descartado por el humano. */
  is_discarded?: boolean;
  /** Email del usuario que descartó el ítem. */
  discarded_by?: string;
  /** Timestamp del descarte. */
  discarded_at?: string;
  /** Timestamp de reactivación. */
  reactivated_at?: string;

  // ── Campos HITL (Etapa 9 - Bóveda 9.0) ────────────────────────────────────
  /** Estado de validación por un experto humano. */
  estado_aprobacion?: EstadoAprobacion;
  /** Observaciones del revisor. */
  review_notes?: string;
  /** Quién aprobó y cuándo (trazabilidad de autoridad). */
  approved_by?: string;
  approved_at?: string;
  /** true = blindado contra IA. Solo un humano puede modificarlo. */
  is_human_locked?: boolean;
  /** Historial de cambios y auditoría. */
  historial_cambios?: HistorialAuditoria[];
  /** Propuestas de cambio pendientes de resolución. */
  pending_conflicts?: ProposedUpdate[];
  /** Cambios autorizados pendientes de aplicar en la siguiente regeneración. */
  authorized_delta_buffer?: ProposedUpdate[];

  // ── Campo de enlace a la Simbología Global ───────────────────────────────
  /** Referencias a los concept_id de master_symbology_vault que ilustran este ítem */
  symbology_refs?: string[];
}


/**
 * PillarDocument — Documento central de cada pilar de la bóveda.
 * Almacena el contenido Markdown completo generado por el agente especializado.
 * Fuentes clasificadas por AUTORÍA (no por dominio web).
 */
export interface PillarDocument {
  /** Identificador del pilar. */
  pillar_id: PillarId;
  /** Estado actual del proceso de generación. */
  status: PillarStatus;
  /** Contenido técnico en Markdown (tablas, viñetas, datos duros). */
  content: string;
  /** Nombre del catálogo global para el que se generó. */
  make_model: string;
  /** Timestamp de última generación exitosa. */
  generated_at: string | null;
  /** Fuentes clasificadas por autoría. */
  classified_sources: {
    /** Documentos producidos por el FABRICANTE (OEM). */
    fabricante: SourceItem[];
    /** Material de terceros (normas, talleres, distribuidores). */
    externos: SourceItem[];
    /** Videos de YouTube (OEM o técnicos verificados). */
    youtube: SourceItem[];
  };
  /** Mensaje de error si status === 'ERROR'. */
  error_message?: string | null;
  /** Aviso de disclaimer técnico por pilar. */
  disclaimer?: string;
  /** Timestamp de última actualización en Firestore. */
  updated_at?: string | null;

  // ── CAMPOS ITEMIZADO (opcionales — retrocompatibles) ──────────────────────
  /** Ítems estructurales generados por el proceso ITEMIZADO. */
  items?: PillarItem[];
  /** Fuentes clasificadas por autoría para el ITEMIZADO (OEM/EXTERNO/YOUTUBE). */
  classified_sources_itemized?: ItemizedSource[];
  /** Sugerencias de ítems complementarios de IA pendientes de aprobación. */
  suggested_items_pending?: Array<{
    title: string;
    rationale: string;
    section: string;
    source?: any;
  }>;
  /** Estado del proceso ITEMIZADO para este pilar. */
  itemize_status?: 'IDLE' | 'GENERATING' | 'COMPLETED' | 'ERROR';
  /** Timestamp de inicio del proceso de itemización. */
  started_at?: any;
  /** Timestamp del último ITEMIZADO exitoso. */
  itemized_at?: string | null;
  /** Mensaje de error del ITEMIZADO si itemize_status === 'ERROR'. */
  itemize_error?: string | null;
}


/** Ítem de inspección de un checklist pre-operacional (5 columnas sin zona). */
export interface ChecklistItem {
  componente: string;
  metodo: string;
  criterio_pasa: string;
  criterio_no_pasa: string;
  accion_inmediata: string;
}

/** Grupo de ítems del checklist agrupados por zona/sección (V2). */
export interface ChecklistGroup {
  zona: string;
  items: ChecklistItem[];
}

/** Estructura compartida para cada pilar de la Bóveda Cuadridimensional. */
export interface VaultDimension {
  indices: Record<string, KnowledgeContribution | null>;
  isGenerated: boolean;
}

export interface GlobalAssetCatalog {
  id: string;
  // Identidad del activo
  make_model: string;
  make: string;
  model: string;
  make_oficial?: string;
  model_oficial?: string;
  categoria_equipo: 'Maquinaria Pesada' | 'Vehículo Liviano' | 'Herramienta Manual' | 'Equipo Auxiliar' | string;
  alias_detectados: string[];

  // ── Perfil Operativo v2.1 (NUEVO — proceso de registro) ───────────────────
  /** A. Denominación genérica exacta del fabricante OEM.
   *  Ej: "CAMIÓN DE EXTRACCIÓN MINERA", "CARGADOR COMPACTO DE CADENAS".
   *  NUNCA usar agrupaciones como "Maquinaria Pesada" o "Vehículo Liviano". */
  tipo_equipo?: string;

  /** B. Entornos físicos, climáticos y geográficos donde opera. Solo datos duros.
   *  Ej: ["ALTITUD HASTA 4265 MSNM", "TEMPERATURA: -40°C A 52°C", "RAJO ABIERTO"] */
  ambiente_operativo?: string[];

  /** C. Tipos de trabajo para los que fue diseñado. Solo datos duros.
   *  Ej: ["MINERÍA A CIELO ABIERTO", "TRANSPORTE DE MINERAL Y ESTÉRIL"] */
  contexto_operativo?: string[];

  /** D. Características principales y esenciales del equipo (capacidades, peso operativo, etc.).
   *  Ej: ["MOTOR CAT C18 ACERT (587 HP)", "PESO OPERATIVO: 47748 KG", "CAPACIDAD DE PALA: 22 M3"] */
  caracteristicas_principales?: string[];

  // Ecosistema de dependencias (consumibles, repuestos)
  ecosystem_dependencies: string[];

  // Bóveda Quintadimensional de Conocimiento — ARQUITECTURA 5 PILARES (v7.0)
  // Cada pilar es un PillarDocument completo (Markdown + fuentes clasificadas).
  knowledge_vault?: {
    ficha_tecnica: PillarDocument;
    manual_operaciones: PillarDocument;
    pauta_mantencion: PillarDocument;
    matriz_riesgos: PillarDocument;
    checklist_pre_op: PillarDocument;
  };

  // Calidad del registro
  health_score: number;
  missing_critical_elements: Record<string, string[]>;

  // Conflictos pendientes de revisión (R4)
  pending_conflicts?: Record<string, any>;

  thumbnail_url?: string;
  /** true = Bloqueado contra modificaciones. Protege la integridad de la bóveda y previene registros de nuevas unidades. */
  is_sealed?: boolean;
  createdAt: Date | any;
  updatedAt: Date | any;
}

// R2: Instanciación de Flota y Propiedad
export interface TenantAsset {
  id: string;
  tenant_id: string;
  global_asset_id: string;
  ownership_type: 'PROPIO' | 'ARRENDADO' | 'CEDIDO';
  identifier_type: 'PATENTE' | 'NUMERO_SERIE' | 'CODIGO_INTERNO';
  identifier_value: string;
  original_jargon?: string;
  make_model?: string;
  make_oficial?: string;
  model_oficial?: string;
  registered_by: string; // userId
  createdAt: Date | any;
}

/**
 * APPEND-ONLY TRUST MODEL — v1.0
 * Metadatos de confianza para cada dato individual de la bóveda.
 * is_human_locked = true blinda el dato contra sobrescritura por IA.
 */
export type DataOrigen = 'IA_INICIAL' | 'IA_ACTUALIZACION' | 'MANUAL_HUMANO';

/**
 * HITL (Human-in-the-Loop) — Estado de Aprobación por Índice
 * GENERADO_IA     → Estado inicial. Pendiente de revisión humana.
 * REQUIERE_CAMBIOS → El revisor dejó observaciones. No puede ser aprobado.
 * APROBADO_HUMANO  → Validado con confirmación dura. Candado de autoridad.
 */
export type EstadoAprobacion = 'GENERADO_IA' | 'REQUIERE_CAMBIOS' | 'APROBADO_HUMANO';

export interface HuntedDataItem {
  /** UUID único por fila — clave de identidad para el merge Append-Only. */
  id_dato: string;
  /** Quién generó este dato. */
  origen: DataOrigen;
  /** true = blindado contra IA. Solo un humano puede modificarlo. */
  is_human_locked: boolean;
  // Campos de contenido
  zona: string;
  componente: string;
  condicion_esperada: string;
  tipo_input?: 'NUMERIC' | 'BOOLEAN' | 'WARNING';
  is_oem?: boolean;
}

/**
 * DIFF ENGINE — v1.0
 * Propuestas de fusión generadas por el Auditor IA.
 * El controlador aplica los NUEVO directamente;
 * los CONFLICTO quedan pendientes de resolución humana.
 */
export interface ProposedUpdate {
  estado_fusion: 'NUEVO' | 'CONFLICTO';
  zona: string;
  componente: string;
  /** Solo presente en NUEVO */
  condicion_esperada?: string;
  tipo_input?: 'NUMERIC' | 'BOOLEAN' | 'WARNING' | 'text_block';
  is_oem?: boolean;
  /** Solo presente en CONFLICTO */
  valor_actual?: string;
  valor_nuevo?: string;
  proposal_id?: string;
  detected_at?: string;
  /** Texto contextual generado por IA explicando el hallazgo al humano */
  synthesis?: string;
  /** null = PENDIENTE (sin decisión). Estado por defecto al crear. */
  human_decision?: 'APROBADO' | 'ELIMINADO' | null;
  decided_at?: string;
  decided_by?: string;
  /** URL o referencia a la fuente técnica de origen que sustenta la propuesta */
  source_url?: string;
}

/**
 * HITL — Trazabilidad ISO 27001 para auditoría de cambios.
 */
export interface HistorialAuditoria {
  fecha: string;
  accion:
    | 'GENERACION_INICIAL'
    | 'SOLICITUD_CORRECCION'
    | 'APROBACION_FINAL'
    | 'PROPUESTA_APROBADA'
    | 'PROPUESTA_ELIMINADA'
    | 'EVOLUCION_NUEVO_CONTENIDO'
    | 'EVOLUCION_CONFLICTOS'
    | 'EDICION_ASISTIDA_GENERAL'
    | 'EDICION_ASISTIDA_CORRECTION'
    | 'EDICION_ASISTIDA_RESEARCH'
    | 'EDICION_ASISTIDA_DELETION'
    | 'CREACION_MANUAL'
    | 'CREACION_IA_COMPLEMENTARIA'
    | 'EVOLUCION_CANCELADA';
  actor: string;
  detalle?: string;
  /** El contenido anterior del ítem para permitir rollback. */
  snapshot_anterior?: string;
  /** Campos específicos que cambiaron. */
  changed_fields?: string[];
}

export interface KnowledgeContribution {
  global_asset_id?: string;
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  /**
   * HITL — Estado de validación a nivel de índice completo.
   * Controlado exclusivamente por revisores humanos.
   */
  estado_aprobacion?: EstadoAprobacion;
  /** Observaciones del revisor cuando el estado es REQUIERE_CAMBIOS. */
  review_notes?: string;
  /** Quién aprobó y cuándo (trazabilidad de autoridad). */
  approved_by?: string;
  approved_at?: string;
  /** Historial inmutable de auditoría para trazabilidad. */
  historial_cambios?: HistorialAuditoria[];
  createdAt?: Date | any;
  title?: string;
  description?: string;
  extracted_data?: HuntedDataItem[];
  /** Estructura agrupada por zona para el pilar Checklist (V2). */
  checklist_groups?: ChecklistGroup[];
  requires_external_hunt?: boolean;
  /** [HITL 3/3] Bloqueo específico para la síntesis técnica (narrativa). */
  is_human_locked?: boolean;
  content: string; // Datos duros y tablas en Markdown.
  schemas_or_images?: string[]; // URLs de Firebase Storage.
  source_metadata: {
    file_name: string;
    uploaded_by: string;
    upload_date: string;
    global_asset_id?: string;
    extraction_engine?: string;
  };
  pending_visual_tasks: Array<{
    description: string;
    source_hint: string;
    is_resolved: boolean;
  }>;

  // Campos del motor HITL y síntesis evolutiva
  synthesis?: string;
  visual_format?: 'TABLE' | 'RICH_TEXT' | 'CHECKLIST';
  ai_hunt_completed?: boolean;
  pending_conflicts?: ProposedUpdate[];
  authorized_delta_buffer?: ProposedUpdate[];
  pending_narrative_proposal?: string | null;
  needs_redaction_refresh?: boolean;
  approved_narrative_draft?: string;
  last_thinking_analisys?: string;
  label?: string;
  agent_role?: string;
  agent_focus?: string;
  web_sources?: string[];
  classified_sources?: {
    oem?: Array<{ dato_aportado: string; url_limpia: string }>;
    terceros?: Array<{ dato_aportado: string; url_limpia: string }>;
    youtube?: Array<{ dato_aportado: string; url_limpia: string }>;
  } | null;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model' | 'system';
  content: string;
  timestamp: string;
  highlightText?: string;
  draftContent?: string;
  intent?: 'CHAT' | 'EDIT_PROPOSAL' | 'RESEARCH_WEB' | 'SEARCH_IMAGE';
}

// ─── ESTRUCTURAS DEL CATÁLOGO GLOBAL DE SIMBOLOGÍA ───────────────────────────

export interface MasterSymbologyVariant {
  /** true = variante confirmada por humano con 'registrar' */
  verified_by_human: boolean;
  /** Email del usuario que registró la variante */
  verified_by?: string;
  /** Timestamp de registro */
  verified_at?: string;
  /** Ruta definitiva en GCS (post-registro) */
  asset_storage_url: string;
  /** Ruta temporal en GCS (pre-registro, solo para preview) */
  temp_storage_url?: string;
  /** Notas de estilo o diferencias visuales respecto al estándar ISO */
  style_notes?: string;
}

export interface MasterSymbologyItem {
  /** PK: slug único derivado de la referencia ISO o del nombre técnico */
  concept_id: string;
  /** Referencia normativa exacta (ej. "ISO 7000 Ref-No. 0436") */
  iso_reference: string;
  /** Nombre técnico en español */
  technical_name_es: string;
  /** Nombre técnico en inglés */
  technical_name_en: string;
  /** Significado operacional completo en español */
  description_es: string;
  /** Significado operacional completo en inglés */
  description_en: string;
  /** Color crítico asociado al símbolo según estándar */
  critical_color: 'RED' | 'YELLOW' | 'GREEN_BLUE' | 'NONE';
  /** URL del ícono base ISO oficial obtenido de Wikimedia Commons */
  standard_icon_url?: string;
  /** URL temporal del ícono base ISO para previsualización antes del registro humano */
  temp_standard_icon_url?: string;
  /** Candidatos de íconos base obtenidos desde Wikimedia antes del DRAW */
  temp_icon_candidates?: Array<{
    url: string;
    source_filename: string;
  }>;
  /** Estado de la búsqueda del ícono ISO oficial */
  standard_icon_status: 'pendiente_busqueda' | 'encontrado' | 'pendiente_dibujo_humano' | 'pendiente_confirmacion_humana';
  /** Mapa de variantes por fabricante. Clave: nombre del fabricante en minúsculas. */
  brands_variants: Record<string, MasterSymbologyVariant>;
  /** Hint para el agente de caza: dónde en la redacción debe insertarse este símbolo */
  insertion_point_hint?: string;
  /** Ítems de activos que referencian este concepto (trazabilidad inversa) */
  referenced_by_items?: string[];  // array de "globalAssetId/pillarId/item_id"
  created_at: string;
  created_by: string;
  updated_at?: string;
}


