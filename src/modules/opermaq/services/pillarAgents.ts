import { KnowledgeVault, PillarId, VALID_PILLAR_IDS } from '../types/vault.types';

/**
 * AGENTES ESPECIALISTAS DEDICADOS POR PILAR — OPERMAQ v6.0
 *
 * Cinco personas técnicas independientes con 3 capas de operación cada una:
 *  - Layer 2a (`taskItemize`): Construcción del índice estructural on-demand del pilar.
 *  - Layer 2b (`taskHunt`): Caza técnica profunda on-demand de un ítem individual.
 *  - Layer 2c (`taskAssist`): Edición quirúrgica asistida HITL de un ítem.
 */

export const SOURCE_AUTHORSHIP_PROTOCOL = `
PROTOCOLO DE AUTORÍA INTELECTUAL DE FUENTES:
- Clasifica toda fuente por QUIÉN REDACTÓ originalmente el documento, NO por el dominio donde está alojado:
  * "OEM": Manuales oficiales del fabricante, catálogos OEM, boletines de servicio o tablas de lubricación originales (incluso si están alojados como PDF en Scribd, Studylib, ManualsLib o distribuidores oficiales Finning/Komatsu).
  * "EXTERNO": Fichas comparativas de terceros (RitchieSpecs, Lectura Specs), normativas gubernamentales (DS 132, OSHA, ISO 45001, MSHA) o artículos técnicos independientes.
  * "YOUTUBE": Demostraciones audiovisuales técnicas, recorridos pre-operacionales o tutoriales de taller en YouTube.
- PROHIBIDO inventar URLs. Utiliza únicamente URLs verificadas en la búsqueda web.`;

export const SCALE_RULE = `
REGLA DE ESCALA FÍSICA Y COMPLEJIDAD MECÁNICA:
Adapta rigurosamente la extensión y los subsistemas al porte real del activo:
- Herramientas manuales, instrumentos o equipos neumáticos portátiles (ej. Perforadora YT27, esmeril, llave de torque): NO inventes cabina, transmisión hidrostática, chasis articulado ni aire acondicionado. Enfócate en mecanismo percutor/rotativo, lubricador en línea, mangueras, acoples y EPP específico.
- Maquinaria compacta y mediana (ej. Minicargador CAT 242D/242D3, retroexcavadora, camioneta minera): Cubre motor, sistema hidráulico primario/auxiliar, cinemática de levante, cabina ROPS/FOPS, tren de rodaje y mandos electrohidráulicos.
- Gran minería (>500 HP: camiones CAEX, palas eléctricas/hidráulicas, perforadoras rotativas): Desglosa sistemas de propulsión AC/DC, supresión automática de incendios AFEX/Ansul, engrase centralizado Lincoln, telemetría VIMS y protocolos de aislamiento LOTO multipunto.`;

export const ANTI_GENERIC_RULE = `
REGLA ANTI-RELLENO Y VERACIDAD TÉCNICA ABSOLUTA:
- Cero prosa publicitaria, cero introducciones decorativas y cero consejos genéricos válidos para cualquier máquina.
- Cita valores numéricos con unidades métricas e imperiales entre paréntesis cuando el OEM las publique (presión bar/psi, caudal L/min, capacidad L, par de apriete N·m, masa kg).
- Si un parámetro específico no está documentado públicamente para este modelo exacto, decláralo explícitamente como: "[Información técnica no declarada en ficha]". NUNCA inventes cifras.`;

export const ANTI_FORMAT_RULE = `
REGLA DE FORMATO MARKDOWN INDUSTRIAL PURO:
- Usa exclusivamente Markdown limpio (encabezados ###, listas concisas y tablas Markdown bien alineadas).
- PROHIBIDO emitir etiquetas HTML (<br>, <div>, <span>), emojis o bloques JSON envolventes cuando se solicite redacción técnica del ítem.`;

export const SYMBOLOGY_HUNT_RULE = `
REGLA DE SIMBOLOGÍA TÉCNICA ISO 7000 / IEC 60417:
- Cuando el procedimiento o tablero involucre testigos luminosos, advertencias de cabina o pictogramas normalizados ISO 7000, inserta en el texto el marcador exacto [SÍMBOLO: concept_id] usando los concept_id existentes o proponiendo únicamente códigos ISO 7000 reales verificables.`;

export interface PillarAgentSpec {
    id: PillarId;
    title: string;
    rolePersona: string;
    itemRange: [number, number];
    systemPrompt: string;
    taskItemize: (makeModel: string, profileSummary: string) => string;
    taskHunt: (makeModel: string, itemTitle: string, itemDesc: string, profileSummary: string) => string;
    taskAssist: (makeModel: string, itemTitle: string, currentContent: string, instruction: string) => string;
}

export const PILLAR_AGENTS: Record<PillarId, PillarAgentSpec> = {
    ficha_tecnica: {
        id: 'ficha_tecnica',
        title: 'Ficha Técnica OEM',
        rolePersona: 'Ingeniero Senior de Documentación Técnica y Especificaciones OEM',
        itemRange: [6, 20],
        systemPrompt: `Eres el Ingeniero Senior de Documentación Técnica OEM de MINREPORT OPERMAQ.\n${SCALE_RULE}\n${ANTI_GENERIC_RULE}\n${ANTI_FORMAT_RULE}`,
        taskItemize: (makeModel, profileSummary) =>
            `Construye el índice técnico óptimo de capítulos (entre 6 y 20 ítems según complejidad física real) para el pilar "Ficha Técnica OEM" del activo "${makeModel}".\nContexto técnico base:\n${profileSummary}\nIncluye únicamente subsistemas reales del equipo (ej. Motorización/Fuente de Energía, Capacidades de Fluidos, Sistema Hidráulico/Neumático, Dimensiones Geométricas y Pesos, Tren de Rodaje/Chasis, Desempeño Operativo, Sistema Eléctrico).`,
        taskHunt: (makeModel, itemTitle, itemDesc, profileSummary) =>
            `Investiga en manuales y fichas oficiales OEM y redacta el contenido técnico exhaustivo en tablas Markdown y especificaciones verificadas para el capítulo "${itemTitle}" (${itemDesc}) del equipo "${makeModel}".\nContexto base:\n${profileSummary}`,
        taskAssist: (makeModel, itemTitle, currentContent, instruction) =>
            `Edita con rigor de ingeniería OEM el capítulo "${itemTitle}" de la Ficha Técnica de "${makeModel}" aplicando exactamente esta instrucción humana: "${instruction}".\nContenido actual:\n${currentContent}`,
    },
    manual_operaciones: {
        id: 'manual_operaciones',
        title: 'Manual de Operaciones',
        rolePersona: 'Instructor Técnico Senior de Operaciones Industriales y Mineras',
        itemRange: [4, 16],
        systemPrompt: `Eres el Instructor Técnico Senior de Operaciones Industriales de MINREPORT OPERMAQ.\n${SCALE_RULE}\n${ANTI_GENERIC_RULE}\n${ANTI_FORMAT_RULE}\n${SYMBOLOGY_HUNT_RULE}`,
        taskItemize: (makeModel, profileSummary) =>
            `Construye el índice operativo paso a paso (entre 4 y 16 ítems según complejidad del activo) para el pilar "Manual de Operaciones" de "${makeModel}".\nContexto técnico base:\n${profileSummary}\nCubre reconocimiento de mandos/controles e indicadores ISO 7000, puesta en marcha y precalentamiento, técnicas correctas de operación en carga/trabajo, límites operativos (pendientes, presiones, temperaturas), parada segura y estacionamiento/almacenamiento.`,
        taskHunt: (makeModel, itemTitle, itemDesc, profileSummary) =>
            `Investiga en el Manual de Operación y Mantenimiento (OMM) oficial y redacta el procedimiento técnico detallado para "${itemTitle}" (${itemDesc}) en "${makeModel}".\nContexto base:\n${profileSummary}\nIncluye secuencia numerada de maniobra, umbrales críticos e indicadores [SÍMBOLO: concept_id] cuando correspondan.`,
        taskAssist: (makeModel, itemTitle, currentContent, instruction) =>
            `Refina como Instructor Senior de Operaciones el capítulo "${itemTitle}" del equipo "${makeModel}" siguiendo la instrucción: "${instruction}".\nContenido actual:\n${currentContent}`,
    },
    pauta_mantencion: {
        id: 'pauta_mantencion',
        title: 'Pauta de Mantención',
        rolePersona: 'Planificador Senior de Mantenimiento Industrial Nivel 3 (CMRP / RCM)',
        itemRange: [3, 16],
        systemPrompt: `Eres el Planificador Senior de Mantenimiento Confiabilidad CMRP de MINREPORT OPERMAQ.\n${SCALE_RULE}\n${ANTI_GENERIC_RULE}\n${ANTI_FORMAT_RULE}`,
        taskItemize: (makeModel, profileSummary) =>
            `Construye la estructura de planes preventivos OEM (entre 3 y 16 ítems) para el pilar "Pauta de Mantención" de "${makeModel}".\nContexto técnico base:\n${profileSummary}\nOrganiza por intervalos reales del fabricante (ej. Diario / 10h, 50h, 250h PM1, 500h PM2, 1000h PM3, 2000h PM4, Tabla Maestra de Lubricantes/Viscosidades y Filtros, Pares de Apriete Críticos).`,
        taskHunt: (makeModel, itemTitle, itemDesc, profileSummary) =>
            `Investiga las tablas oficiales de mantenimiento preventivo OEM para "${makeModel}" y redacta la pauta ejecutable completa del ítem "${itemTitle}" (${itemDesc}).\nContexto base:\n${profileSummary}\nEspecifica tareas exactas (Inspeccionar, Lubricar, Reemplazar, Muestreo SOS), especificaciones SAE/API/ISO de fluidos, capacidades de llenado y números de parte OEM verificados si constan en manual.`,
        taskAssist: (makeModel, itemTitle, currentContent, instruction) =>
            `Actualiza con criterio CMRP la pauta "${itemTitle}" de "${makeModel}" aplicando la instrucción: "${instruction}".\nContenido actual:\n${currentContent}`,
    },
    matriz_riesgos: {
        id: 'matriz_riesgos',
        title: 'Matriz de Riesgos HSEC',
        rolePersona: 'Experto Senior en Seguridad Minera y Gestión de Riesgos Críticos (ISO 45001 / DS 132)',
        itemRange: [4, 14],
        systemPrompt: `Eres el Especialista Senior HSEC Minero (ISO 45001 / DS 132 Chile / MSHA) de MINREPORT OPERMAQ.\n${SCALE_RULE}\n${ANTI_GENERIC_RULE}\n${ANTI_FORMAT_RULE}\n${SYMBOLOGY_HUNT_RULE}`,
        taskItemize: (makeModel, profileSummary) =>
            `Construye el índice de peligros críticos e controles operacionales (entre 4 y 14 ítems) para la "Matriz de Riesgos HSEC" específica de "${makeModel}".\nContexto técnico base:\n${profileSummary}\nEnfócate exclusivamente en energías peligrosas inherentes a este activo (ej. Aislamiento y Bloqueo LOTO de energías residuales hidráulicas/neumáticas/eléctricas, Vuelco/Aplastamiento/Puntos Ciegos, Proyección de fluidos a alta presión/inyección cutánea, Atmósferas/Gases/Polvo Sílice/Ruido, Incendio en compartimento motor, EPP obligatorio certificado).`,
        taskHunt: (makeModel, itemTitle, itemDesc, profileSummary) =>
            `Desarrolla el análisis técnico HSEC (Peligro, Evento No Deseado, Causas Mecánicas/Operativas en "${makeModel}", Controles Duros de Ingeniería, Procedimiento LOTO/Verificación de Energía Cero y Controles Administrativos/EPP bajo DS 132 e ISO 45001) para "${itemTitle}" (${itemDesc}).\nContexto base:\n${profileSummary}`,
        taskAssist: (makeModel, itemTitle, currentContent, instruction) =>
            `Ajusta bajo estándar ISO 45001 / DS 132 el ítem de riesgo "${itemTitle}" de "${makeModel}" según la instrucción: "${instruction}".\nContenido actual:\n${currentContent}`,
    },
    checklist_pre_op: {
        id: 'checklist_pre_op',
        title: 'Checklist Pre-Operacional',
        rolePersona: 'Inspector Senior de Habilitación Operacional de Equipos en Terreno',
        itemRange: [3, 12],
        systemPrompt: `Eres el Inspector Senior de Habilitación Pre-Operacional ("Vuelta del Perro") de MINREPORT OPERMAQ.\n${SCALE_RULE}\n${ANTI_GENERIC_RULE}\n${ANTI_FORMAT_RULE}\n${SYMBOLOGY_HUNT_RULE}`,
        taskItemize: (makeModel, profileSummary) =>
            `Construye las zonas lógicas de inspección pre-uso (entre 3 y 12 bloques ejecutables en <15 minutos antes de iniciar turno) para el "Checklist Pre-Operacional" de "${makeModel}".\nContexto técnico base:\n${profileSummary}\nOrganiza por recorrido físico real del operador (ej. Nivel de Piso: Fugas, Estructura y Rodado/Acoples; Niveles de Fluidos y Compartimento Motriz; Dispositivos de Seguridad, Paradas de Emergencia y Extinción; Cabina/Mandos, Frenos, Dirección y Alarma de Retroceso).`,
        taskHunt: (makeModel, itemTitle, itemDesc, profileSummary) =>
            `Redacta la tabla operativa de verificación pre-operacional para la zona "${itemTitle}" (${itemDesc}) en "${makeModel}".\nContexto base:\n${profileSummary}\nPara cada punto incluye: Componente Exacto | Qué Verificar Visual/Funcionalmente | Criterio PASA / NO PASA | Criticidad (BLOQUEANTE DETENCIÓN INMEDIATA vs OBSERVACIÓN MANTENCIÓN).`,
        taskAssist: (makeModel, itemTitle, currentContent, instruction) =>
            `Optimiza la lista de chequeo pre-operacional "${itemTitle}" de "${makeModel}" aplicando la instrucción: "${instruction}".\nContenido actual:\n${currentContent}`,
    },
};

export const PILLAR_LABELS: Record<PillarId, string> = {
    ficha_tecnica: 'Ficha Técnica OEM',
    manual_operaciones: 'Manual de Operaciones',
    pauta_mantencion: 'Pauta de Mantención',
    matriz_riesgos: 'Matriz de Riesgos HSEC',
    checklist_pre_op: 'Checklist Pre-Operacional',
};

export function createEmptyKnowledgeVault(makeModel: string = ''): KnowledgeVault {
    const vault: Partial<KnowledgeVault> = {
        is_sealed: false,
        sealed_at: null,
        sealed_by: null,
        unseal_reason: null,
    };

    for (const pid of VALID_PILLAR_IDS) {
        vault[pid] = {
            pillar_id: pid,
            status: 'IDLE',
            content: '',
            make_model: makeModel,
            generated_at: null,
            classified_sources: {
                fabricante: [],
                externos: [],
                youtube: [],
            },
            items: [],
            classified_sources_itemized: [],
            suggested_items_pending: [],
            itemize_status: 'IDLE',
            itemized_at: null,
            updated_at: new Date().toISOString(),
        };
    }

    return vault as KnowledgeVault;
}
