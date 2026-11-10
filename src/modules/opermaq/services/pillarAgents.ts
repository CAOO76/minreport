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
- INTEGRIDAD DE TABLAS (UNA SOLA LÍNEA POR FILA): Cada fila de cualquier tabla Markdown (\`| ... |\`) DEBE escribirse íntegramente en una sola línea continua sin saltos de línea (\`\\n\`) ni etiquetas \`<br>\` dentro de sus celdas, respetando exactamente la cantidad de columnas del encabezado y sin dejar líneas en blanco entre filas consecutivas de una misma tabla.
- PROHIBIDO emitir etiquetas HTML (\`<br>\`, \`<div>\`, \`<span>\`), emojis o bloques JSON envolventes cuando se solicite redacción técnica del ítem.`;

export const SYMBOLOGY_HUNT_RULE = `
REGLA DE SIMBOLOGÍA TÉCNICA POR MENCIÓN EXPLÍCITA ESTRICTA (CERO ESPECULACIÓN):
- PROHIBIDO insertar marcadores [SÍMBOLO: ...] por especulación, asociación semántica o en filas de especificaciones técnicas nominales.
- Un símbolo normativo (ISO 7000, ISO 7010, ISO 2575, IEC 60417 o GHS) SOLO se referencia cuando el texto o manual mencione explícitamente un testigo luminoso de tablero, una señal/etiqueta de seguridad grabada en el equipo, un EPP obligatorio o el código literal de la norma (ej. ISO 7000-0248, ISO 7010-M014, IEC 60417-5172, GHS02).`;

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
        itemRange: [4, 24],
        systemPrompt: `Eres el Ingeniero Senior de Documentación Técnica OEM de MINREPORT OPERMAQ.\n${SCALE_RULE}\n${ANTI_GENERIC_RULE}\n${ANTI_FORMAT_RULE}`,
        taskItemize: (makeModel, profileSummary) =>
            `Construye el índice técnico elástico de capítulos para el pilar "Ficha Técnica OEM" del activo "${makeModel}" aplicando la Arquitectura de Ontología Elástica en 2 Anillos:\n` +
            `1. ANILLO 1 (NÚCLEO MÍNIMO INVARIANTE DEL TIPO): Incluye siempre en primer lugar los capítulos basales obligatorios del TIPO indicados en el contexto para garantizar comparabilidad transversal.\n` +
            `   - REGLA INVIOLABLE DE ÍTEM DEDICADO A CONSUMOS: El itemizado base de Ficha Técnica DEBE incluir obligatoriamente un capítulo independiente y dedicado exclusivamente a CONSUMOS (Combustible Diésel/Gasolina/Gas, Energía Eléctrica de Red o Batería, Aire Comprimido, DEF/AdBlue u otros vectores energéticos según el tipo de equipo) y AUTONOMÍA OPERATIVA. Queda estrictamente prohibido omitir este capítulo o fusionarlo dentro de "Motorización / Planta Motriz" o "Capacidades de Llenado de Fluidos".\n` +
            `2. ANILLO 2 (SUBSISTEMAS CONDICIONALES BASADOS EN EVIDENCIA): Revisa el catálogo de subsistemas condicionales del TIPO; activa únicamente aquellos respaldados por evidencia real de este modelo específico "${makeModel}" (jamás infles un equipo simple como un furgón utilitario o herramienta manual con subsistemas Heavy-Duty inexistentes).\n` +
            `3. EXPANSIÓN ABIERTA SIN TECHO POR COMPLEJIDAD DEL MODELO: Si "${makeModel}" es un activo de alta complejidad (ej. camioneta Heavy-Duty con PTO/Quinta Rueda/DRW o maquinaria minera Ultra-Class con múltiples subsistemas de propulsión, enfriamiento de ejes RAX, retardo ARC, telemetría VIMS/TPMS, etc.), agrega libremente TODOS los capítulos adicionales que requieran sus subsistemas físicos reales verificados en las fuentes OEM, sin quedar limitado por equipos más simples registrados antes.\n` +
            `Contexto técnico y ontológico del activo:\n${profileSummary}`,
        taskHunt: (makeModel, itemTitle, itemDesc, profileSummary) =>
            `Investiga en manuales y fichas técnicas oficiales OEM y redacta el desarrollo técnico exhaustivo para el capítulo "${itemTitle}" (${itemDesc}) del activo "${makeModel}".\n\n` +
            `PROTOCOLO DE INGENIERÍA PARA FICHA TÉCNICA OEM (PILAR 01):\n` +
            `1. ESTRUCTURA TABULAR OBLIGATORIA DE 3 COLUMNAS:\n` +
            `   Organiza los parámetros en tablas Markdown con las columnas:\n` +
            `   | Parámetro / Especificación | Valor OEM Verificado (SI + Imperial) | Norma / Condición de Medición |\n` +
            `2. RIGOR POR DOMINIO FÍSICO DEL CAPÍTULO:\n` +
            `   - Si trata de IDENTIFICACIÓN / CONFIGURACIÓN: marca, modelo exacto, familia/prefijo de serie, clase física, certificaciones estructurales (ROPS ISO 3471 / FOPS ISO 3449) y nivel de emisiones (Tier / Stage / Euro).\n` +
            `   - Si trata de MOTOR / PLANTA MOTRIZ: modelo de motor, cilindrada (L), carrera × diámetro (mm), potencia bruta y neta al volante (kW / HP @ rpm bajo SAE J1349 o ISO 14396), par motor máximo (N·m @ rpm), reserva de par (%), sistema de inyección y alternador/baterías (V / A / CCA).\n` +
            `   - Si trata de MATRIZ ENERGÉTICA / CONSUMOS / EFICIENCIA / COMBUSTIBLE / AUTONOMÍA: fuente primaria de energía (Diésel, Gasolina, Eléctrico Red AC, Eléctrico Batería BEV, Híbrido Diésel-Eléctrico, Híbrido Gasolina-Eléctrico, Dual-Fuel Diésel-Gas, GLP/GNV, Neumático, Hidráulico), consumo horario nominal (L/h, kWh/h, L/s), tabla desglosada de consumos por factor de carga (baja / media / alta severidad), rendimiento vial en ciclo urbano/carretera/mixto (km/L y L/100 km si aplica a camión o vehículo utilitario), consumo específico de combustible BSFC (g/kWh o lb/hp·h), consumo de urea/DEF (% respecto a diésel), capacidad utilizable de estanque (L) o pack de baterías (kWh) y autonomía estimada en turno operacional para costeo.\n` +
            `   - Si trata de TRANSMISIÓN / TREN DE FUERZA / HIDRÁULICA / NEUMÁTICA: tipo de bomba/transmisión, caudal máximo (L/min @ rpm), presiones de alivio principal/auxiliar/piloto (bar / psi), velocidades de traslado por marcha (km/h) y fuerzas de tracción/arranque (kN).\n` +
            `   - Si trata de DIMENSIONES, PESOS Y ENVOLVENTE DE TRABAJO: peso operativo (kg), peso de embarque (kg), carga nominal o límite de equilibrio estático (kg), longitud/ancho/altura total (mm), despeje al suelo (mm), radio de giro (mm) y alcance/altura máxima de descarga (mm).\n` +
            `   - Si trata de CAPACIDADES DE SERVICIO Y LLENADO: tabla desglosada por compartimento (estanque de combustible, cárter de motor con filtro, sistema de enfriamiento, tanque hidráulico, sistema hidráulico total, transmisión/diferenciales/mandos finales, DEF/AdBlue) expresada en litros (L).\n` +
            `3. PROHIBICIÓN DE SIMBOLOGÍA ESPECULATIVA EN FICHA TÉCNICA:\n` +
            `   NO insertes etiquetas [SÍMBOLO: ...] junto a parámetros nominales (potencia, presiones de diseño, pesos, dimensiones o capacidades). Solo cita un código normativo de símbolo si la ficha técnica oficial declara expresamente un marcado normativo físico en placa (ej. IEC 60417-5172 Clase II).\n` +
            `4. CONFINAMIENTO DE ALCANCE (CERO REPETICIÓN ENTRE CAPÍTULOS):\n` +
            `   Desarrolla EXCLUSIVAMENTE los parámetros pertenecientes a "${itemTitle}". NO repitas especificaciones que correspondan a los capítulos hermanos listados en el contexto.\n\n` +
            `Contexto técnico, capítulos hermanos y cifras ya confirmadas:\n${profileSummary}`,
        taskAssist: (makeModel, itemTitle, currentContent, instruction) =>
            `Edita con rigor de ingeniería OEM el capítulo "${itemTitle}" de la Ficha Técnica de "${makeModel}" aplicando exactamente esta instrucción humana: "${instruction}".\nContenido actual:\n${currentContent}`,
    },
    manual_operaciones: {
        id: 'manual_operaciones',
        title: 'Manual de Operaciones',
        rolePersona: 'Instructor Técnico Senior de Operaciones Industriales y Mineras',
        itemRange: [4, 24],
        systemPrompt: `Eres el Instructor Técnico Senior de Operaciones Industriales de MINREPORT OPERMAQ.\n${SCALE_RULE}\n${ANTI_GENERIC_RULE}\n${ANTI_FORMAT_RULE}`,
        taskItemize: (makeModel, profileSummary) =>
            `Construye el índice operativo elástico y cronológico para el pilar "Manual de Operaciones" del activo "${makeModel}" aplicando la Arquitectura de Ontología Elástica en 2 Anillos y las 5 Fases Cronológicas de Operación:\n` +
            `1. ANILLO 1 (5 FASES CRONOLÓGICAS INVARIANTES SEGÚN CLASE DEL TIPO):\n` +
            `   - FASE I — ARQUITECTURA DE MANDOS, CABINA / EMPUÑADURA Y SEÑALES: Reconocimiento de controles físicos, selectores, instrumentación, testigos luminosos y alarmas reales del equipo (sin inventar cabina ni tablero automotriz si es herramienta manual o equipo estacionario).\n` +
            `   - FASE II — PUESTA EN MARCHA, PRECALENTAMIENTO Y PRUEBAS FUNCIONALES: Secuencia antes y después del arranque/energización, verificación de frenos/dirección/parada de emergencia y calentamiento operacional.\n` +
            `   - FASE III — TÉCNICAS DE OPERACIÓN PRODUCTIVA Y CICLO DE TRABAJO: Procedimientos paso a paso de la función principal del activo (conducción, carguío, excavación, perforación, izaje, bombeo/generación o corte/desbaste).\n` +
            `   - FASE IV — LÍMITES OPERATIVOS, CONDICIONES ADVERSAS Y MODOS ESPECIALES: Pendientes máximas, estabilidad, gran altitud, temperatura extrema, polvo/sílice y operación de subsistemas condicionales del modelo.\n` +
            `   - FASE V — PARADA NORMAL, ESTACIONAMIENTO, EMERGENCIA Y BLOQUEO LOTO: Enfriamiento de turbo/sistemas, parqueo y acuñamiento, respuesta ante alarmas críticas, remolque/rescate y aislamiento de energía cero LOTO.\n` +
            `2. ANILLO 2 (MODOS Y SUBSISTEMAS OPERATIVOS CONDICIONALES BASADOS EN EVIDENCIA + HERENCIA DEL PILAR 01):\n` +
            `   - Revisa la estructura ya confirmada del Pilar 01 (Ficha Técnica OEM) y el catálogo condicional del TIPO en el contexto.\n` +
            `   - Si "${makeModel}" es un activo simple (ej. furgón utilitario 4x2 o herramienta portátil), mantén el manual esbelto (4 a 7 capítulos) sin inventar caja reductora 4x4, PTO ni retardo continuo.\n` +
            `   - Si "${makeModel}" es un activo complejo o Heavy-Duty/Ultra-Class (ej. camioneta pesada con 4x4 4H/4L, modo Tow/Haul, Freno de Escape, Toma de Fuerza PTO y Regeneración DPF; o camión minero con Retardo Dinámico ARC, Freno de Carga, Telemetría VIMS Nivel 1/2/3, Monitoreo TKPH y Remolque de Emergencia), desglosa TODOS los capítulos operativos específicos necesarios sin techo artificial.\n` +
            `Contexto técnico, herencia del Pilar 01 y ontología del activo:\n${profileSummary}`,
        taskHunt: (makeModel, itemTitle, itemDesc, profileSummary) =>
            `Investiga en el Manual de Operación y Mantenimiento (OMM) oficial y redacta el desarrollo técnico y procedimental exhaustivo para el capítulo "${itemTitle}" (${itemDesc}) del activo "${makeModel}".\n\n` +
            `PROTOCOLO DE INGENIERÍA OPERATIVA OMM (PILAR 02 · MANUAL DE OPERACIONES):\n` +
            `1. ESTRUCTURA TÉCNICA Y TABULAR SEGÚN LA FASE CRONOLÓGICA DEL CAPÍTULO:\n` +
            `   - Si pertenece a FASE I (MANDOS, CABINA / EMPUÑADURA E INSTRUMENTACIÓN):\n` +
            `     a) Incluye tabla de Controles y Mandos Físicos:\n` +
            `        | Mando / Selector / Pedal | Ubicación Física | Función y Posiciones Operativas | Condición de Enclavamiento / Bloqueo |\n` +
            `     b) Incluye tabla de Instrumentación, Testigos y Categorías de Alerta OEM:\n` +
            `        | Testigo / Indicador Luminoso | Categoría / Nivel de Alerta OEM | Umbral o Condición de Activación (SI + Imperial) | Acción Inmediata del Operador |\n` +
            `     c) Si el activo es una herramienta manual o equipo estacionario, describe empuñadura, gatillo/válvula, manómetros y panel local (PROHIBIDO inventar cabina, asiento, volante o joysticks).\n` +
            `   - Si pertenece a FASE II (PUESTA EN MARCHA, PRECALENTAMIENTO Y PRUEBAS FUNCIONALES):\n` +
            `     a) Condiciones de enclavamiento de seguridad previos al arranque (Interlocks: neutro, freno de estacionamiento, barra/apoyabrazos o válvula cerrada).\n` +
            `     b) Secuencia numerada de arranque normal y en frío + tiempos y temperaturas de precalentamiento de motor y sistema hidráulico.\n` +
            `     c) Tabla de Pruebas Funcionales Dinámicas Pre-Trabajo:\n` +
            `        | Sistema a Verificar | Maniobra de Prueba en Vacío | Respuesta Normal Esperada | Criterio de Detención Inmediata (No Operar) |\n` +
            `   - Si pertenece a FASE III (TÉCNICAS DE OPERACIÓN PRODUCTIVA Y CICLO DE TRABAJO):\n` +
            `     a) Secuencia técnica paso a paso de cada etapa del ciclo productivo real del activo (ataque/excavación/carguío/traslado/descarga o perforación/bombeo/operación en carga).\n` +
            `     b) Parámetros operativos nominales (marchas, rangos de RPM/caudal/presión, posicionamiento del implemento u órgano de trabajo) y prohibiciones operativas expresas del fabricante.\n` +
            `   - Si pertenece a FASE IV (LÍMITES OPERATIVOS, CONDICIONES ADVERSAS Y SUBSISTEMAS ESPECIALIZADOS — ANILLO 2):\n` +
            `     a) Tabla de Límites Operativos y Umbrales Críticos OEM:\n` +
            `        | Parámetro / Condición Operativa | Límite Máximo / Nominal OEM (SI + Imperial) | Respuesta del Sistema (Derateo / Alarma) | Acción Correctiva del Operador |\n` +
            `     b) Procedimiento paso a paso de activación, regulación y desactivación segura del modo o subsistema especializado del capítulo.\n` +
            `   - Si pertenece a FASE V (PARADA NORMAL, ESTACIONAMIENTO, EMERGENCIA Y AISLAMIENTO OPERATIVO):\n` +
            `     a) Secuencia de enfriamiento gradual (tiempo exacto en ralentí y temperatura objetivo antes de cortar contacto), bajada de implementos a piso, alivio de presión residual, parqueo y acuñamiento.\n` +
            `     b) Procedimientos de emergencia OEM: parada de emergencia, dirección/freno secundario, liberación de frenos y puntos de anclaje para remolque de emergencia (con velocidad y distancia máximas de remolque) y secuencia de corte maestro de batería / energía cero.\n` +
            `2. COHERENCIA INVIOLABLE CON EL PILAR 01 (FICHA TÉCNICA OEM):\n` +
            `   Respeta exactamente las cifras ya verificadas en el Pilar 01 (potencia, presiones, caudales, capacidades nominales ROC/carga, masas, velocidades y volúmenes) incluidas en el contexto. PROHIBIDO contradecirlas.\n` +
            `3. CONFINAMIENTO ESTRICTO POR FASE (CERO REPETICIÓN ENTRE CAPÍTULOS):\n` +
            `   Desarrolla EXCLUSIVAMENTE los procedimientos y tablas correspondientes a "${itemTitle}". NO desarrolles fases ni subsistemas que pertenezcan a los capítulos hermanos listados en el contexto.\n\n` +
            `Contexto técnico, especificaciones heredadas del Pilar 01 y capítulos hermanos:\n${profileSummary}`,
        taskAssist: (makeModel, itemTitle, currentContent, instruction) =>
            `Refina como Instructor Senior de Operaciones el capítulo "${itemTitle}" del equipo "${makeModel}" siguiendo la instrucción: "${instruction}".\nContenido actual:\n${currentContent}`,
    },
    pauta_mantencion: {
        id: 'pauta_mantencion',
        title: 'Pauta de Mantención',
        rolePersona: 'Planificador Senior de Mantenimiento Industrial Nivel 3 (CMRP / RCM)',
        itemRange: [4, 24],
        systemPrompt: `Eres el Planificador Senior de Mantenimiento y Confiabilidad CMRP de MINREPORT OPERMAQ.\n${SCALE_RULE}\n${ANTI_GENERIC_RULE}\n${ANTI_FORMAT_RULE}`,
        taskItemize: (makeModel, profileSummary) =>
            `Construye el índice elástico y estructurado para el pilar "Pauta de Mantención" del activo "${makeModel}" aplicando la Arquitectura de Ontología Elástica en 2 Anillos y las 6 Etapas Lógicas CMRP:\n` +
            `1. ANILLO 1 (6 ETAPAS LÓGICAS DE MANTENIMIENTO SEGÚN UNIDAD RECTORA DEL TIPO — HORÓMETRO, KILOMETRAJE O JORNADA):\n` +
            `   - ETAPA I — LUBRICANTES, FLUIDOS Y CONSUMIBLES OEM: Carta maestra de viscosidades SAE/ISO, normas API/ACEA/OEM, refrigerante, grasas, filtros y capacidades de llenado verificadas contra el Pilar 01.\n` +
            `   - ETAPA II — MANTENIMIENTO RUTINARIO DIARIO Y SEMANAL: Tareas de corta frecuencia (10 h / 50 h en maquinaria pesada; inspección semanal y cada 5.000 km severo en camionetas/utilitarios; pre/post-jornada y lubricación en línea en herramientas), drenaje de sedimentos y mapa de puntos de engrase.\n` +
            `   - ETAPA III — PAUTAS PREVENTIVAS MENORES E INTERMEDIAS (PM1 / PM2): Servicios programados primarios e intermedios (250 h PM1 y 500 h PM2 en maquinaria; 10.000 km PM1 y 20.000 km PM2 en vehículos; mensual/trimestral en estacionarios).\n` +
            `   - ETAPA IV — PAUTAS PREVENTIVAS MAYORES Y OVERHAUL (PM3 / PM4): Servicios mayores (1.000 h PM3, 2.000 h PM4, 4.000 h+ en maquinaria; 40.000 km a 100.000 km en vehículos; overhaul y reemplazo de piezas de desgaste internas en herramientas).\n` +
            `   - ETAPA V — MANTENIMIENTO DE SUBSISTEMAS ESPECIALIZADOS Y PDM (ANILLO 2 + HERENCIA DE PILARES 01 Y 02): Activa capítulos específicos para cada subsistema avanzado confirmado en los Pilares 01 y 02 (ej. muestreo tribológico S·O·S, frenos húmedos enfriados por aceite, acumuladores ISO 3450, enfriamiento de ejes RAX, Autolube, sensores TPMS, neumáticos gigantes, caja de transferencia 4x4, eje Dually DRW, Toma de Fuerza PTO, Quinta Rueda o DPF/DEF SCR).\n` +
            `   - ETAPA VI — PARES DE APRIETE, TOLERANCIAS Y LOTO DE MANTENCIÓN: Torques críticos (ruedas, tornamesa, GET, tirantes), límites dimensionales de condena y protocolo de despresurización/aislamiento LOTO previo a intervenir.\n` +
            `2. REGLA DE ELASTICIDAD POR COMPLEJIDAD DEL MODELO: Si "${makeModel}" es un activo simple (ej. furgón 4x2 o herramienta manual), mantén la pauta esbelta (5 a 6 capítulos) sin inventar pautas horométricas de excavadora ni subsistemas inexistentes; si es un activo Heavy-Duty o Ultra-Class, despliega todos los capítulos especializados necesarios sin techo artificial.\n` +
            `Contexto técnico, herencia de los Pilares 01 y 02 y ontología del activo:\n${profileSummary}`,
        taskHunt: (makeModel, itemTitle, itemDesc, profileSummary) =>
            `Ejecuta el PROTOCOLO DE INGENIERÍA DE MANTENIMIENTO CMRP/RCM (PILAR 03) consultando el Manual de Operación y Mantenimiento (OMM) y manuales de servicio OEM oficiales para "${makeModel}" y redacta la pauta técnica ejecutable para "${itemTitle}" (${itemDesc}):\n` +
            `1. ESTRUCTURA TÉCNICA OBLIGATORIA SEGÚN LA ETAPA CMRP DEL CAPÍTULO (6 ETAPAS + ANILLO 2):\n` +
            `   - Si el capítulo pertenece a ETAPA I (Especificaciones de Lubricantes, Fluidos, Filtros y Capacidades OEM):\n` +
            `     a) Tabla Maestra de Lubricantes, Fluidos y Capacidades de Llenado:\n` +
            `        | Compartimento / Sistema | Fluido y Norma Técnica OEM (API / ACEA / Cat / ISO) | Grado de Viscosidad SAE / ISO VG | Capacidad de Llenado Oficial (SI + Imperial) | Intervalo de Cambio / Muestreo |\n` +
            `     b) Tabla de Filtros, Respiraderos y Elementos Consumibles:\n` +
            `        | Elemento Filtrante / Respiradero | Ubicación en el Equipo | Función y Eficiencia / Micraje | Código de Parte OEM Verificado | Intervalo de Reemplazo |\n` +
            `        (PROHIBIDO inventar números de parte OEM: si el código exacto del filtro no consta literalmente en la fuente verificada, escribe [Código de parte OEM no declarado en fuente]).\n` +
            `   - Si el capítulo pertenece a ETAPA II (Mantenimiento Rutinario Diario / Semanal y Puntos de Engrase):\n` +
            `     a) Tabla de Mantenimiento Rutinario de Corta Frecuencia (adaptada a la unidad rectora real del activo: 10 h / 50 h en maquinaria pesada; semanal / 5.000 km severo en vehículos; pre/post-jornada en herramientas):\n` +
            `        | Punto de Servicio / Componente | Acción Técnica (Inspeccionar / Drenar / Lubricar / Purgar) | Frecuencia OEM | Especificación / Grasa / Criterio PASA-NO PASA |\n` +
            `     b) Mapa tabular de puntos de engrase (cantidad de graseras Zerk, ubicación física y tipo de grasa NLGI / MoS2), drenaje de agua/sedimentos de combustible y limpieza de antefiltros.\n` +
            `   - Si el capítulo pertenece a ETAPA III (Pautas Preventivas Menores e Intermedias PM1 / PM2) o ETAPA IV (Pautas Preventivas Mayores PM3 / PM4 / Overhaul):\n` +
            `     a) Tabla Ejecutable de Pauta Preventiva CMRP:\n` +
            `        | Subsistema / Componente | Acción Técnica (Reemplazar / Inspeccionar / Calibrar / Limpiar / S·O·S) | Intervalo OEM | Fluido / Insumo y Capacidad (SI + Imperial) | Criterio Técnico / Par de Apriete / Tolerancia |\n` +
            `     b) Procedimiento técnico paso a paso para las intervenciones críticas del intervalo (drenaje en caliente, reemplazo de filtros, cebado del circuito, ajuste de holgura de válvulas, servicio de correas/cadenas o lavado de sistema).\n` +
            `   - Si el capítulo pertenece a ETAPA V (Mantenimiento de Subsistemas Especializados y Monitoreo de Condición S·O·S / PDM — Anillo 2):\n` +
            `     a) Tabla de Monitoreo de Condición y Límites de Alerta/Condena OEM:\n` +
            `        | Subsistema / Punto de Control | Parámetro Monitoreado (S·O·S / Desgaste / Presión / Limpieza ISO 4406) | Intervalo de Control | Valor Nominal / Límite de Condena OEM | Acción Correctiva |\n` +
            `     b) Procedimiento específico de servicio, toma de muestra en vivo, prueba de acumuladores ISO 3450, medición de desgaste de discos húmedos, limpieza DPF/DEF o mantenimiento del subsistema especializado heredado de los Pilares 01 y 02.\n` +
            `   - Si el capítulo pertenece a ETAPA VI (Pares de Apriete Críticos, Límites de Desgaste y Aislamiento LOTO de Mantención):\n` +
            `     a) Tabla de Pares de Apriete Críticos y Límites Dimensionales de Condena:\n` +
            `        | Unión / Perno / Elemento de Desgaste | Medida / Grado | Par de Apriete OEM (N·m + lb-ft/in-lb) o Límite de Condena (mm) | Secuencia / Condición de Aplicación |\n` +
            `     b) Tabla de Aislamiento de Energías Peligrosas (LOTO) y Verificación de Energía Cero Pre-Intervención:\n` +
            `        | Fuente de Energía (Mecánica / Hidráulica / Eléctrica / Neumática / Gravitacional) | Dispositivo de Aislamiento y Bloqueo LOTO | Procedimiento de Disipación / Purga de Presión Residual | Verificación de Energía Cero |\n` +
            `2. COHERENCIA INVIOLABLE CON LOS PILARES 01 Y 02:\n` +
            `   Respeta con exactitud matemática las capacidades de llenado (litros/galones), viscosidades, presiones hidráulicas/neumáticas, potencias y umbrales térmicos ya verificados en los Pilares 01 y 02 incluidos en el contexto. PROHIBIDO contradecirlos.\n` +
            `3. CONFINAMIENTO ESTRICTO POR ETAPA (CERO REPETICIÓN ENTRE CAPÍTULOS):\n` +
            `   Desarrolla EXCLUSIVAMENTE las tablas y procedimientos correspondientes a "${itemTitle}". NO repitas las pautas ni tablas de otros intervalos o etapas que pertenezcan a los capítulos hermanos listados en el contexto.\n\n` +
            `Contexto técnico, especificaciones heredadas de los Pilares 01 y 02 y capítulos hermanos:\n${profileSummary}`,
        taskAssist: (makeModel, itemTitle, currentContent, instruction) =>
            `Actualiza con criterio CMRP la pauta "${itemTitle}" de "${makeModel}" aplicando la instrucción: "${instruction}".\nContenido actual:\n${currentContent}`,
    },
    matriz_riesgos: {
        id: 'matriz_riesgos',
        title: 'Matriz de Riesgos HSEC',
        rolePersona: 'Experto Senior en Seguridad Minera y Gestión de Riesgos Críticos (ISO 45001 / DS 132)',
        itemRange: [4, 20],
        systemPrompt: `Eres el Especialista Senior HSEC Minero (ISO 45001 / DS 132 Chile / MSHA) de MINREPORT OPERMAQ.\n${SCALE_RULE}\n${ANTI_GENERIC_RULE}\n${ANTI_FORMAT_RULE}`,
        taskItemize: (makeModel, profileSummary) =>
            `Construye el índice de peligros críticos y controles para la "Matriz de Riesgos HSEC" específica de "${makeModel}" (ISO 45001 / ISO 12100 / DS 132 Chile).\nContexto técnico y pilares previos:\n${profileSummary}\n\nESTRUCTURA OBLIGATORIA EN 2 ANILLOS + 6 DOMINIOS HSEC (campo "section" debe iniciar con el dominio correspondiente):\n- DOMINIO I — AISLAMIENTO Y CONTROL DE ENERGÍAS PELIGROSAS (LOTO)\n- DOMINIO II — RIESGOS CRÍTICOS EN OPERACIÓN (derivados de las maniobras confirmadas en 02 · Manual de Operaciones)\n- DOMINIO III — RIESGOS EN INTERVENCIÓN Y MANTENCIÓN (derivados de las tareas confirmadas en 03 · Pauta de Mantención)\n- DOMINIO IV — RIESGOS DE SUBSISTEMAS ESPECIALIZADOS (un capítulo por cada subsistema especializado real confirmado en 01, 02 o 03; omitir si el activo no lo posee)\n- DOMINIO V — HIGIENE OCUPACIONAL Y AGENTES FÍSICOS/QUÍMICOS (DS 594 / PREXOR / PLANESI / ISO 2631 / ISO 5349)\n- DOMINIO VI — INCENDIO, EMERGENCIAS Y EPP\n\nREGLAS:\n- Adapta los peligros a la naturaleza física real del activo: no atribuyas vuelco, cabina o puntos ciegos a herramientas manuales o equipos estacionarios; no atribuyas PTO, quinta rueda, acumuladores o neumáticos gigantes a activos que no los poseen.\n- Cada capítulo nombra un peligro/evento no deseado concreto del activo, no categorías genéricas.\n- Trazabilidad 1 a 1: todo subsistema especializado y toda intervención de alta energía de los pilares previos debe tener su capítulo de riesgo.`,
        taskHunt: (makeModel, itemTitle, itemDesc, profileSummary) =>
            `Desarrolla el capítulo técnico de la Matriz de Riesgos HSEC "${itemTitle}" (${itemDesc}) para el activo exacto "${makeModel}" bajo estándar ISO 45001, ISO 12100, DS 132 Seguridad Minera (Chile) y DS 594.\n\n` +
            `PROTOCOLO DE INGENIERÍA DE SEGURIDAD Y RIESGOS CRÍTICOS HSEC (PILAR 04 — 100% ESTÁNDAR TABULAR INDUSTRIAL):\n` +
            `1. SALIDA 100% TABULAR OPERATIVA (PROHIBIDO TEXTO PLANO Y LISTAS NUMERADAS SUELTAS):\n` +
            `   - PROHIBIDO redactar párrafos introductorios, preámbulos narrativos o listas numeradas en texto plano (1., 2., 3...).\n` +
            `   - Tanto la Matriz de Peligros/Controles como todo Procedimiento Operativo (Secuencia de Aislamiento LOTO, Verificación de Energía Cero, Protocolo de Actuación o Respuesta a Emergencias) DEBEN presentarse EXCLUSIVAMENTE en tablas Markdown ordenadas.\n\n` +
            `2. ESTRUCTURA DE DOS TABLAS OBLIGATORIAS SEGÚN EL DOMINIO HSEC DEL CAPÍTULO:\n` +
            `   a) TABLA 1 — MATRIZ IPER / HSEC DE PELIGROS Y CONTROLES (5 COLUMNAS):\n` +
            `      | Peligro y Fuente de Energía en el Activo | Evento No Deseado y Consecuencia | Magnitud / Umbral Crítico SI (Imperial) | Controles Duros de Ingeniería y Bloqueo LOTO (Energía Cero) | Controles Administrativos, EPP Certificado y Norma |\n` +
            `      | :--- | :--- | :--- | :--- | :--- |\n` +
            `      - Si corresponde a DOMINIO I (Aislamiento, Bloqueo LOTO y Energía Cero): inventaría todas las energías peligrosas presentes en "${makeModel}" (mecánica/gravitacional en brazos/tolva/implemento, hidráulica/acumuladores, eléctrica 12V/24V, térmica en motor/escape/refrigerante, neumática y química).\n` +
            `      - Si corresponde a DOMINIO II (Riesgos Críticos en Operación y Maniobra): analiza los peligros de fatalidad o accidente grave derivados de las maniobras confirmadas en el Pilar 02 según la naturaleza física real del activo (vuelco ROPS/FOPS ISO 3471/3449, pérdida de estabilidad por sobrecarga sobre ROC, aplastamiento en radio de giro/puntos ciegos, colisión o contacto con líneas eléctricas; atrapamiento rotatorio, latigazo de mangueras whipcheck y proyección de partículas en estacionarios/herramientas).\n` +
            `      - Si corresponde a DOMINIO III (Riesgos en Intervención Mecánica, Izaje y Mantención): analiza los peligros mortales derivados de las tareas del Pilar 03 (aplastamiento bajo brazos de levante/tolva/chasis sin traba mecánica o caballetes certificados, inyección cutánea de fluido hidráulico o diésel Common-Rail a alta presión, escaldadura por apertura en caliente de circuito presurizado, liberación de resortes/cadenas/acumuladores e izaje de componentes pesados).\n` +
            `      - Si corresponde a DOMINIO IV / Anillo 2 (Riesgos de Subsistemas Especializados): analiza los peligros específicos del subsistema condicional confirmado en el modelo (hidráulica auxiliar High-Flow/XHP, desacoplamiento involuntario de acople rápido, regeneración térmica DPF > 600 °C, descarga de acumuladores ISO 3450, piroforicidad/explosión de neumáticos o llantas, toma de fuerza PTO, quinta rueda o doble rodado DRW).\n` +
            `      - Si corresponde a DOMINIO V (Higiene Ocupacional y Agentes Físicos/Químicos — DS 594 / PREXOR / PLANESI): evalúa exposición a ruido ocupacional (dB(A) / PREXOR), vibración de cuerpo entero (ISO 2631-1 en m/s²) o mano-brazo (ISO 5349 en m/s²), polvo respirable / sílice libre cristalizada (PLANESI en mg/m³), emisiones diésel (DPM / CO / NOx) y manejo manual de carga (Ley 20.949). Si el nivel de emisión propio del "${makeModel}" no figura en fuente OEM, declara textualmente "[Nivel acústico / vibratorio del equipo no declarado en fuente OEM]" junto al límite legal aplicable.\n` +
            `      - Si corresponde a DOMINIO VI (Prevención de Incendios, Respuesta a Emergencias y EPP Certificado): identifica el triángulo de fuego en "${makeModel}" (puntos calientes de turbo/múltiple/DPF frente a líneas de combustible/hidráulicas y cortocircuito eléctrico), sistemas de supresión (AFEX / extintor PQS ABC) y matriz de EPP específico con norma técnica de certificación (EN 166 / ANSI Z87.1, EN 388, EN 352, ISO 20345).\n` +
            `   b) TABLA 2 — PROCEDIMIENTO OPERATIVO ESTÁNDAR PASO A PASO (4 COLUMNAS — OBLIGATORIA PARA TODA SECUENCIA LOTO, ENERGÍA CERO, INTERVENCIÓN O PROTOCOLO DE EMERGENCIA):\n` +
            `      | Paso | Etapa / Punto de Intervención | Procedimiento Operativo de Control / Maniobra | Criterio de Verificación / Magnitud Nominal (SI) |\n` +
            `      | :---: | :--- | :--- | :--- |\n` +
            `      - Columna 1 ("Paso"): numeración correlativa de dos dígitos ("01", "02", "03", "04", "05"...).\n` +
            `      - Columna 2 ("Etapa / Punto de Intervención"): nombre técnico de la etapa y punto físico/dispositivo en el "${makeModel}".\n` +
            `      - Columna 3 ("Procedimiento Operativo de Control / Maniobra"): instrucción técnica secuencial de aislamiento, bloqueo, purga, control o respuesta.\n` +
            `      - Columna 4 ("Criterio de Verificación / Magnitud Nominal (SI)"): condición verificable o estado de Energía Cero (0 V, 0 bar (0 psi), 0 RPM, < 50 °C, traba mecánica asentada, candado/Tagout instalado).\n\n` +
            `3. PROHIBICIÓN DE PUNTAJES SUBJETIVOS INVENTADOS (P × S) Y SINTAXIS DE FILA:\n` +
            `   - PROHIBIDO inventar índices numéricos subjetivos (Probabilidad × Severidad = MR). Clasifica la criticidad de forma normativa ("CRÍTICO — FATALIDAD / GRAVE (DS 132)", "ALTO", "MEDIO") respaldada por la magnitud física real de la energía heredada de los Pilares 01, 02 y 03 (bar (psi), kW (HP), kg (lb), V, °C (°F), L/min (gpm)).\n` +
            `   - PROHIBIDO contradecir las cifras confirmadas en los Pilares 01, 02 y 03.\n` +
            `   - Cada fila de tabla DEBE escribirse en UNA SOLA LÍNEA continua sin etiquetas <br>.\n\n` +
            `4. POLÍTICA DE CITAS VISUALES Y SIMBOLOGÍA NORMATIVA (ISO 7010 / GHS / IEC 60417):\n` +
            `   - Cita códigos normativos de seguridad literales (ej. ISO 7010 W012, ISO 7010 W015, ISO 7010 W017, ISO 7010 W019, ISO 7010 W024, ISO 7010 W029, ISO 7010 M003, ISO 7010 M004, ISO 7010 M008, ISO 7010 M009, ISO 7010 M014, ISO 7010 M017, ISO 7010 M018, ISO 7010 M021, ISO 7010 F001, ISO 7010 E001, GHS02, GHS04, GHS05, GHS08, GHS09) ÚNICAMENTE en las filas donde dicho peligro, bloqueo o EPP sea directamente exigible.\n` +
            `   - Menciona diagramas o mapas de etiquetas ("según el diagrama de zonas de atrapamiento / puntos de bloqueo LOTO / etiquetas de advertencia") SOLO cuando la ubicación espacial en el equipo sea indispensable.\n\n` +
            `5. CONFINAMIENTO ESTRICTO DE ALCANCE:\n` +
            `   Desarrolla EXCLUSIVAMENTE las tablas correspondientes a "${itemTitle}". NO repitas el desarrollo de otros dominios que pertenezcan a los capítulos hermanos listados en el contexto.\n\n` +
            `Contexto técnico, especificaciones heredadas de los Pilares 01, 02 y 03 y capítulos hermanos:\n${profileSummary}`,
        taskAssist: (makeModel, itemTitle, currentContent, instruction) =>
            `Ajusta bajo estándar ISO 45001 / DS 132 el ítem de riesgo "${itemTitle}" de "${makeModel}" según la instrucción: "${instruction}".\nContenido actual:\n${currentContent}`,
    },
    checklist_pre_op: {
        id: 'checklist_pre_op',
        title: 'Checklist Pre-Operacional',
        rolePersona: 'Inspector Senior de Habilitación Operacional de Equipos en Terreno',
        itemRange: [3, 16],
        systemPrompt: `Eres el Inspector Senior de Habilitación Pre-Operacional ("Vuelta del Perro") de MINREPORT OPERMAQ.\n${SCALE_RULE}\n${ANTI_GENERIC_RULE}\n${ANTI_FORMAT_RULE}`,
        taskItemize: (makeModel, profileSummary) =>
            `Construye las zonas de inspección pre-uso (ejecutables en < 15 minutos antes de iniciar turno) del "Checklist Pre-Operacional" de "${makeModel}", como síntesis terminal de los Pilares 01, 02, 03 y 04.\nContexto técnico y pilares previos:\n${profileSummary}\n\nESTRUCTURA OBLIGATORIA EN 2 ANILLOS + 6 ZONAS CRONOLÓGICAS DE RECORRIDO (campo "section" debe iniciar con la zona correspondiente):\n- ZONA I — INSPECCIÓN PERIMETRAL, ESTRUCTURA Y ESTANQUEIDAD (equipo detenido, frío y bloqueado)\n- ZONA II — NIVELES DE FLUIDOS Y LÍNEAS DE SUMINISTRO DE ENERGÍA (derivado de la Etapa II diaria de 03 · Pauta de Mantención)\n- ZONA III — IMPLEMENTOS Y SUBSISTEMAS ESPECIALIZADOS (una zona por cada subsistema especializado real confirmado en 01–04; omitir si el activo no lo posee)\n- ZONA IV — DISPOSITIVOS DE SEGURIDAD CRÍTICA Y SUPRESIÓN (barreras duras de 04 · Matriz de Riesgos)\n- ZONA V — CABINA, INSTRUMENTACIÓN Y VISIBILIDAD (omitir si el activo no posee cabina/puesto de comando)\n- ZONA VI — PUESTA EN MARCHA Y PRUEBA FUNCIONAL (derivado de la Fase II de 02 · Manual de Operaciones)\n\nREGLAS:\n- Adapta el recorrido a la naturaleza física real del activo: en herramientas manuales/estacionarios verifica mangueras, cadena antilatigazo (whipcheck), lubricador, cables/puesta a tierra, guardas y gatillo hombre muerto; no incluyas cabina, rodado ni alarma de retroceso si no existen.\n- Cada zona nombra componentes concretos del activo verificables visual o funcionalmente, no categorías genéricas.\n- Ordena según el recorrido físico real: inspección en frío antes de energizar; prueba dinámica al final.`,
        taskHunt: (makeModel, itemTitle, itemDesc, profileSummary) =>
            `Construye la lista de chequeo pre-operacional 100% operativa para la zona "${itemTitle}" (${itemDesc}) del activo exacto "${makeModel}" bajo el estándar binario de habilitación en terreno (SERNAGEOMIN DS 132 Arts. 43/52, MSHA 30 CFR § 56.14100 y Caterpillar TA1 Level 1 Walkaround).\n\n` +
            `PROTOCOLO ESTRICTO DE CHECKLIST PRE-OPERACIONAL BINARIO (PILAR 05):\n` +
            `1. SALIDA 100% OPERATIVA EN FORMATO TABLA DE CHECKLIST (CERO PROSA NARRATIVA):\n` +
            `   - PROHIBIDO redactar párrafos introductorios, resúmenes teóricos o prosa explicativa antes o después de la tabla.\n` +
            `   - El capítulo consiste EXCLUSIVAMENTE en la tabla ordenada de verificación pre-operacional y una línea final de regla de bloqueo.\n` +
            `   - Todo punto debe ser ejecutable por el operador antes de iniciar turno (< 15 min) sin herramientas de taller. PROHIBIDO incluir tareas de mantenimiento periódico de taller (250 h–2.000 h, cambios de aceite/filtros, ajuste de válvulas o muestreo S·O·S de laboratorio).\n\n` +
            `2. ESQUEMA TABULAR INVARIANTE DE 6 COLUMNAS Y PROHIBICIÓN DE TÉRMINOS MEDIOS:\n` +
            `   Utiliza OBLIGATORIAMENTE esta estructura exacta de 6 columnas:\n` +
            `   | N° | Punto / Componente de Inspección | Criterio Técnico de Aceptación (Umbral SI / Imperial) | CUMPLE | NO CUMPLE | OBSERVACIONES |\n` +
            `   | :---: | :--- | :--- | :---: | :---: | :--- |\n` +
            `   - Columna 1 ("N°"): numeración correlativa de dos dígitos ordenada según el recorrido físico ("01", "02", "03"...).\n` +
            `   - Columna 2 ("Punto / Componente de Inspección"): componente físico exacto del "${makeModel}" e instrucción de inspección directa ("Visual en frío", "Mirilla / Varilla", "Funcional en cabina", "Prueba dinámica") separados por guion largo " — " en la misma línea.\n` +
            `   - Columna 3 ("Criterio Técnico de Aceptación (Umbral SI / Imperial)"): condición binaria exacta de aprobación y rango físico heredado de los Pilares 01, 02, 03 y 04 (bar (psi), L (gal), V, °C (°F), mm (in), dB(A), 0 fugas, 100% de pernos/tuercas). PROHIBIDO contradecir las cifras confirmadas en los pilares previos.\n` +
            `   - Columna 4 ("CUMPLE"): escribir siempre el casillero "[ ]".\n` +
            `   - Columna 5 ("NO CUMPLE"): escribir siempre el casillero "[ ]".\n` +
            `   - Columna 6 ("OBSERVACIONES"): dejar vacía o con "—" para anotación de hallazgos/lecturas en terreno.\n` +
            `   - REGLA DE SINTAXIS DE FILA: Cada fila de la tabla (desde "| 01 |" hasta el "|" final de OBSERVACIONES) DEBE escribirse en UNA SOLA LÍNEA continua. Queda ESTRICTAMENTE PROHIBIDO insertar saltos de línea o etiquetas <br> dentro de una celda.\n` +
            `   - PROHIBICIÓN ABSOLUTA DE TÉRMINOS MEDIOS Y DE "N/A": no existen estados intermedios ("Regular", "Observación menor", "Operar con precaución") ni columna "No Aplica". Si un punto no satisface el Criterio Técnico de Aceptación, se marca "NO CUMPLE", lo que inhabilita inmediatamente el equipo y exige aplicar bloqueo LOTO.\n\n` +
            `3. CONTENIDO ESPECÍFICO SEGÚN LA ZONA CRONOLÓGICA DEL RECORRIDO:\n` +
            `   - Si corresponde a ZONA I (Inspección Perimetral a Nivel de Piso: Estructura, Rodado/Anclaje y Estanqueidad — Equipo Detenido y Frío): ausencia de fugas bajo el activo, estado de bastidor/chasis/soldaduras, neumáticos/llantas/tuercas/presión de inflado u orugas/rodillos/tensión (o base de anclaje/carcasa en estacionarios) y caja de bloqueo LOTO/cortacorriente a nivel de piso.\n` +
            `   - Si corresponde a ZONA II (Niveles de Fluidos, Compartimento Motriz y Líneas de Suministro de Energía — En Frío Pre-Arranque): nivel en varilla/mirilla de aceite de motor, refrigerante ELC, aceite hidráulico, transmisión, drenaje de separador agua/diésel, nivel DEF/AdBlue, estado de mangueras/correas/radiador y baterías/bornes (o mangueras neumáticas con cadena antilatigazo whipcheck y lubricador en línea).\n` +
            `   - Si corresponde a ZONA III / Anillo 2 (Implementos, Órganos de Trabajo y Subsistemas Especializados): acoplador rápido (pasadores bloqueados ISO 13031), balde/hoja/cuchilla/dientes, vástagos de cilindros sin rayaduras ni fugas, conectores hidráulicos auxiliares (High-Flow/XHP), traba mecánica de brazos de levante/tolva y subsistemas condicionales del modelo.\n` +
            `   - Si corresponde a ZONA IV (Dispositivos de Seguridad Crítica, Supresión de Incendios y Accesos): extintor portátil PQS ABC (manómetro en franja verde 12–14 bar (175–200 psi), sello y pasador íntegros), sistema AFEX, paradas de emergencia, cortacorriente maestro (ISO 7000-0639), guardas de partes rotatorias, peldaños/pasamanos (3 puntos de apoyo ISO 7010 W008), cuñas, pértiga/baliza y legibilidad de etiquetas ISO 7010.\n` +
            `   - Si corresponde a ZONA V (Cabina / Puesto de Comando, Ergonomía, Instrumentación y Visibilidad): estructura ROPS/FOPS (ISO 3471 / ISO 3449), cinturón de seguridad retráctil (ISO 7000-0249), barra/interlock de retención del operador, asiento, espejos, parabrisas/limpiaparabrisas, salida de emergencia (ISO 7010 E001), orden/limpieza interior y autochequeo del panel monitor (Categorías de Advertencia 1, 2 y 3 sin códigos activos).\n` +
            `   - Si corresponde a ZONA VI (Puesta en Marcha y Prueba Funcional Dinámica): toque de bocina pre-arranque (ISO 7000-0029), arranque en frío, extinción de testigos de baja presión de aceite/carga, prueba de bloqueo neutral/interlock, prueba estática y dinámica de freno de estacionamiento (ISO 7000-0238) y freno de servicio, respuesta de dirección/joysticks (ISO/SAE), alarma acústica de retroceso (≥ 85 dB(A)) y luces de trabajo.\n\n` +
            `4. POLÍTICA DE SIMBOLOGÍA NORMATIVA Y CONFINAMIENTO POR ZONA:\n` +
            `   - Cita códigos normativos literales (ej. ISO 7000-0248, ISO 7000-0246, ISO 7000-0238, ISO 7000-0249, ISO 7000-0639, ISO 7000-1410, ISO 7000-1658, ISO 7010 W008, ISO 7010 F001, ISO 7010 E001) únicamente en la fila donde se inspeccione ese control, mirilla o dispositivo.\n` +
            `   - Desarrolla EXCLUSIVAMENTE los puntos de verificación de "${itemTitle}". NO repitas los puntos que pertenezcan a las demás zonas hermanas listadas en el contexto.\n\n` +
            `Contexto técnico, especificaciones heredadas de los Pilares 01, 02, 03 y 04 y zonas hermanas:\n${profileSummary}`,
        taskAssist: (makeModel, itemTitle, currentContent, instruction) =>
            `Actualiza la tabla de checklist pre-operacional binario (columnas: N° | Punto / Componente de Inspección | Criterio Técnico de Aceptación (Umbral SI / Imperial) | CUMPLE | NO CUMPLE | OBSERVACIONES, sin términos medios ni N/A) de "${itemTitle}" para "${makeModel}" aplicando la instrucción: "${instruction}".\nContenido actual:\n${currentContent}`,
    },
};

export const PILLAR_LABELS: Record<PillarId, string> = {
    ficha_tecnica: 'Ficha Técnica OEM',
    manual_operaciones: 'Manual de Operaciones',
    pauta_mantencion: 'Pauta de Mantención',
    matriz_riesgos: 'Matriz de Riesgos HSEC',
    checklist_pre_op: 'Checklist Pre-Operacional',
};

/**
 * Devuelve las invariantes estructurales y tabulares de edición de cada pilar (`01..05`)
 * para que toda intervención desde la columna lateral derecha (`processVaultChat`, `assistItemEdit`, `evolveItemContent`)
 * respete el contrato de formato y la coherencia con pilares previos.
 */
export function getPillarEditGovernancePrompt(pillarId: PillarId): string {
    switch (pillarId) {
        case 'ficha_tecnica':
            return (
                `INVARIANTES DE EDICIÓN — PILAR 01 (FICHA TÉCNICA OEM):\n` +
                `- Toda especificación debe presentarse en tabla Markdown de 3 columnas: | Parámetro / Especificación | Valor OEM Verificado (SI + Imperial) | Norma / Condición de Medición |.\n` +
                `- Si editas el capítulo dedicado de Consumos / Matriz Energética, conserva el desglose horario por factor de carga (baja/media/alta severidad), unidad rectora (L/h, kWh/h, km/L, L/s), consumo específico BSFC, DEF/AdBlue y autonomía.\n` +
                `- PROHIBIDO insertar marcadores [SÍMBOLO: ...] especulativos junto a parámetros nominales.`
            );
        case 'manual_operaciones':
            return (
                `INVARIANTES DE EDICIÓN — PILAR 02 (MANUAL DE OPERACIONES OMM):\n` +
                `- Conserva las tablas operativas de la fase correspondiente (Controles/Mandos, Testigos/Categorías de Alerta OEM, Pruebas Funcionales Dinámicas o Límites Operativos) en una sola línea continua por fila.\n` +
                `- Respeta estrictamente las magnitudes verificadas en el Pilar 01 (Ficha Técnica OEM) sin contradecir presiones, caudales, capacidades ni potencias.`
            );
        case 'pauta_mantencion':
            return (
                `INVARIANTES DE EDICIÓN — PILAR 03 (PAUTA DE MANTENCIÓN CMRP/RCM):\n` +
                `- Conserva las tablas ejecutables de mantenimiento (Lubricantes/Fluidos/Capacidades, Filtros, Rutina Diaria, PM1–PM4, S·O·S/PDM o Pares de Apriete/LOTO) en una sola línea continua por fila.\n` +
                `- PROHIBIDO inventar códigos de parte OEM (usar "[Código de parte OEM no declarado en fuente]" si no consta) y prohibido contradecir las capacidades en litros del Pilar 01.`
            );
        case 'matriz_riesgos':
            return (
                `INVARIANTES DE EDICIÓN — PILAR 04 (MATRIZ DE RIESGOS HSEC ISO 45001 / DS 132):\n` +
                `- SALIDA 100% TABULAR OPERATIVA: prohibido agregar párrafos narrativos o listas en texto plano.\n` +
                `- Mantén la estructura de TABLA 1 (5 columnas: Peligro y Fuente de Energía | Evento No Deseado y Consecuencia | Magnitud / Umbral Crítico SI | Controles Duros de Ingeniería y Bloqueo LOTO | Controles Administrativos, EPP Certificado y Norma) y TABLA 2 (4 columnas: Paso | Etapa / Punto de Intervención | Procedimiento Operativo de Control / Maniobra | Criterio de Verificación / Magnitud Nominal (SI)).\n` +
                `- PROHIBIDO inventar puntajes subjetivos (P × S = MR).`
            );
        case 'checklist_pre_op':
            return (
                `INVARIANTES DE EDICIÓN — PILAR 05 (CHECKLIST PRE-OPERACIONAL BINARIO):\n` +
                `- SALIDA 100% EN TABLA BINARIA DE 6 COLUMNAS (CERO PROSA NARRATIVA): | N° | Punto / Componente de Inspección | Criterio Técnico de Aceptación (Umbral SI / Imperial) | CUMPLE | NO CUMPLE | OBSERVACIONES |.\n` +
                `- En CUMPLE y NO CUMPLE escribe siempre "[ ]". PROHIBIDO estados intermedios o "N/A", y prohibido incluir tareas de taller (250 h–2.000 h).`
            );
    }
}

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
