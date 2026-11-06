import { getAllSigns, type Sign } from '@iso-safety-signs/core';
import { convertBuffer } from '@visioncortex/vtracer';
import { db } from '../../../config/firebase';
import { CasStorageService } from '../../../core/media/CasStorageService';
import { MediaDigestorServer } from '../../../core/media/MediaDigestorServer';
import type { SymbologyStandardFamily } from '../types/vault.types';

/**
 * UNIVERSAL SYMBOLOGY SEED & VECTORIZER ENGINE v4.0 (`OpermaqUniversalSymbologyEngine`)
 *
 * Cubre de fábrica (100% vectorial `.svg`, 0 carga manual obligatoria):
 * 1. `ISO 7010` completa (332+ señales oficiales vía `@iso-safety-signs/core`: `M`, `W`, `P`, `E`, `F`).
 * 2. `ISO 7000` / `ISO 6405` (Testigos de cabina, fluidos, filtros, hidráulica, DPF/DEF, ROPS y controles de maquinaria pesada).
 * 3. `ISO 2575` (Testigos automotrices y camiones de servicio/extracción: frenos, ABS, 4x4, TPMS, batería, check engine).
 * 4. `IEC 60417` (Herramientas eléctricas, tableros y equipos estacionarios: Clase II doble cuadrado, tierra PE, AC/DC, HV).
 * 5. `GHS01–GHS09` ( Sustancias peligrosas, aceites hidráulicos, electrolito de baterías, sílice y combustibles).
 * 6. Vectorizador automático `@visioncortex/vtracer` WASM para transformar recortes raster OEM de PDFs en `.svg` puro.
 */

interface CuratedTechnicalSymbolSeed {
    concept_id: string;
    standard_family: SymbologyStandardFamily;
    iso_reference: string;
    technical_name_es: string;
    technical_name_en: string;
    action_operator_es: string;
    critical_color: 'RED' | 'AMBER' | 'GREEN' | 'BLUE' | 'NONE';
    svg: string;
    tags: string[];
}

// Diccionario técnico en español para las señales ISO 7010 más frecuentes en minería, maquinaria y talleres
const ISO_7010_ES_TRANSLATIONS: Record<string, { nameEs: string; actionEs: string }> = {
    M001: { nameEs: 'Acción obligatoria general', actionEs: 'Cumplir instrucción operativa adjunta antes de operar.' },
    M002: { nameEs: 'Leer manual de instrucciones OEM', actionEs: 'Consultar el manual de operación y mantenimiento antes de intervenir.' },
    M003: { nameEs: 'Uso obligatorio de protección auditiva', actionEs: 'Utilizar protector auditivo certificado durante toda la operación.' },
    M004: { nameEs: 'Uso obligatorio de protección ocular', actionEs: 'Utilizar lentes/antiparras de seguridad contra proyección de partículas.' },
    M005: { nameEs: 'Conectar terminal de puesta a tierra', actionEs: 'Verificar continuidad de puesta a tierra antes de energizar.' },
    M006: { nameEs: 'Desconectar enchufe de red eléctrica', actionEs: 'Desenchufar alimentación antes de ajuste, cambio de disco o mantención.' },
    M008: { nameEs: 'Uso obligatorio de calzado de seguridad', actionEs: 'Utilizar calzado industrial con puntera de protección certificada.' },
    M009: { nameEs: 'Uso obligatorio de guantes de protección', actionEs: 'Utilizar guantes apropiados al riesgo mecánico, térmico o químico.' },
    M013: { nameEs: 'Uso obligatorio de careta facial', actionEs: 'Utilizar protector facial completo contra esquirlas o salpicaduras.' },
    M014: { nameEs: 'Uso obligatorio de casco de seguridad', actionEs: 'Mantener casco industrial con barbiquejo ajustado en área operativa.' },
    M015: { nameEs: 'Uso obligatorio de ropa de alta visibilidad', actionEs: 'Portar chaleco o vestimenta reflectante de alta visibilidad en faena.' },
    M017: { nameEs: 'Uso obligatorio de protección respiratoria', actionEs: 'Utilizar respirador con filtros adecuados contra polvo/sílice/gases.' },
    M018: { nameEs: 'Uso obligatorio de arnés anticaídas', actionEs: 'Anclar arnés de cuerpo completo sobre 1.8 m o en plataformas.' },
    M020: { nameEs: 'Uso obligatorio de cinturón de seguridad', actionEs: 'Abrochar cinturón de retención en cabina ROPS antes de mover el equipo.' },
    M021: { nameEs: 'Desconectar antes de realizar mantenimiento (LOTO)', actionEs: 'Aplicar bloqueo y etiquetado de energía cero antes de intervenir.' },
    M024: { nameEs: 'Transitar por vía peatonal segregada', actionEs: 'Mantener segregación hombre-máquina respetando sendas peatonales.' },
    W001: { nameEs: 'Advertencia de peligro general', actionEs: 'Evaluar condiciones del entorno y controles críticos antes de proceder.' },
    W002: { nameEs: 'Peligro de material explosivo', actionEs: 'Respetar radio de exclusión de tronadura y protocolo de polvorines.' },
    W008: { nameEs: 'Peligro de caída a distinto nivel', actionEs: 'Usar tres puntos de apoyo al subir/bajar de la maquinaria.' },
    W010: { nameEs: 'Peligro de baja temperatura / congelamiento', actionEs: 'Verificar precalentamiento y anticongelante antes de arranque en frío.' },
    W011: { nameEs: 'Peligro de superficie resbaladiza', actionEs: 'Limpiar barro, grasa o hielo de peldaños y pasamanos del equipo.' },
    W012: { nameEs: 'Peligro de tensión eléctrica / electrocución', actionEs: 'Mantener distancia de seguridad a líneas eléctricas y aislar circuitos.' },
    W014: { nameEs: 'Peligro de tránsito de montacargas / maquinaria', actionEs: 'Mantener contacto visual con el operador y respetar radio de giro.' },
    W015: { nameEs: 'Peligro de cargas suspendidas', actionEs: 'Prohibido ubicarse o transitar bajo carga suspendida o pluma.' },
    W016: { nameEs: 'Peligro de sustancia tóxica', actionEs: 'Evitar inhalación o contacto dérmico; revisar HDS correspondiente.' },
    W017: { nameEs: 'Peligro de superficie caliente / quemaduras', actionEs: 'Esperar enfriamiento de escape, turbo, radiador o hidráulico antes de abrir.' },
    W018: { nameEs: 'Peligro de arranque automático', actionEs: 'Bloquear energía (LOTO); el equipo puede arrancar de forma remota.' },
    W019: { nameEs: 'Peligro de aplastamiento por partes móviles', actionEs: 'Instalar traba de articulación/cilindro antes de ingresar a zona de pellizco.' },
    W021: { nameEs: 'Peligro de material inflamable', actionEs: 'Detener motor y eliminar fuentes de ignición durante carga de combustible.' },
    W023: { nameEs: 'Peligro de sustancia corrosiva', actionEs: 'Usar protección ocular y guantes resistentes al manipular baterías o ácidos.' },
    W024: { nameEs: 'Peligro de atrapamiento de manos', actionEs: 'No introducir manos en correas, ventiladores, cadenas o acoples activos.' },
    W025: { nameEs: 'Peligro de rodillos / engranajes contrarrotantes', actionEs: 'Mantener todas las guardas mecánicas instaladas antes de energizar.' },
    W026: { nameEs: 'Peligro en carga de baterías (hidrógeno)', actionEs: 'Cargar baterías en recinto ventilado sin chispas ni llamas abiertas.' },
    W029: { nameEs: 'Peligro de cilindro / sistema presurizado', actionEs: 'Despresurizar acumuladores y líneas hidráulicas/neumáticas antes de soltar.' },
    P001: { nameEs: 'Prohibición general', actionEs: 'Acción estrictamente prohibida durante la operación del activo.' },
    P002: { nameEs: 'Prohibido fumar', actionEs: 'No fumar cerca de estanques de combustible, baterías o solventes.' },
    P003: { nameEs: 'Prohibido generar llama abierta o chispas', actionEs: 'Impedir trabajos en caliente sin permiso de fuego y purga previa.' },
    P004: { nameEs: 'Prohibido el paso a peatones', actionEs: 'Área exclusiva de maniobra de equipos pesados; ingreso restringido.' },
    P006: { nameEs: 'Prohibido acceso a equipos no autorizados', actionEs: 'Solo personal acreditado con licencia interna vigente.' },
    P010: { nameEs: 'Prohibido tocar', actionEs: 'No tocar componentes energizados, rotatorios o a alta temperatura.' },
    P011: { nameEs: 'Prohibido apagar con agua', actionEs: 'Usar extintor PQS ABC o CO2 en incendios eléctricos o de hidrocarburos.' },
    P015: { nameEs: 'Prohibido introducir la mano', actionEs: 'Riesgo severo de amputación; detener y bloquear antes de desobstruir.' },
    P031: { nameEs: 'Prohibido alterar dispositivos de seguridad', actionEs: 'Nunca puentear microswitches, guardas, válvulas de alivio ni sensores ROPS.' },
    F001: { nameEs: 'Extintor contra incendios a bordo', actionEs: 'Verificar manómetro en zona verde, sello intacto y certificación vigente.' },
    E001: { nameEs: 'Vía de evacuación / salida de emergencia', actionEs: 'Identificar salida secundaria de cabina (martillo rompecristales / escotilla).' },
    E003: { nameEs: 'Botiquín de primeros auxilios', actionEs: 'Verificar dotación completa y vigencia de insumos en cabina/faena.' },
    E011: { nameEs: 'Estación lavaojos de emergencia', actionEs: 'Irrigar durante al menos 15 minutos ante proyección química o de polvo.' },
};

function wrapIso7000Svg(strokeColor: string, innerPaths: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="${strokeColor}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="58" height="58" stroke="${strokeColor}" stroke-width="2" opacity="0.28"/>${innerPaths}</svg>`;
}

function wrapGhsDiamondSvg(innerPaths: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><polygon points="32,4 60,32 32,60 4,32" fill="#FFFFFF" stroke="#DC2626" stroke-width="4.2"/><g stroke="#111827" fill="#111827" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${innerPaths}</g></svg>`;
}

/**
 * Catálogo vectorial maestro `ISO 7000` / `ISO 6405` / `ISO 2575` / `IEC 60417` / `GHS`
 * diseñado geométricamente en `.svg` puro de alta legibilidad para cabinas y manuales técnicos.
 */
const CURATED_MACHINERY_AND_ELECTRICAL_SEEDS: CuratedTechnicalSymbolSeed[] = [
    // ── ISO 7000 / 6405 / 2575: Testigos Críticos de Motor, Transmisión e Hidráulica ──
    {
        concept_id: 'iso_7000_0248_engine_oil_pressure',
        standard_family: 'ISO_7000',
        iso_reference: 'ISO 7000-0248',
        technical_name_es: 'Presión de aceite de motor',
        technical_name_en: 'Engine lubricating oil pressure',
        action_operator_es: 'ROJO: Detener equipo en lugar seguro y apagar motor de inmediato; verificar nivel y fugas.',
        critical_color: 'RED',
        svg: wrapIso7000Svg('#DC2626', '<path d="M12 38h24l8-8h8M16 38v-8h14v8M23 30v-6M18 24h10M10 34l4 4M52 36c0 3-2 5-2 5s-2-2-2-5a2 2 0 1 1 4 0z"/>'),
        tags: ['diesel', 'gasoline', 'engine', 'earthmoving', 'vehicle', 'genset', 'compressor'],
    },
    {
        concept_id: 'iso_7000_0246_coolant_temperature',
        standard_family: 'ISO_7000',
        iso_reference: 'ISO 7000-0246',
        technical_name_es: 'Temperatura de refrigerante de motor',
        technical_name_en: 'Engine coolant temperature',
        action_operator_es: 'ROJO: Detener carga operativa, ralentizar para enfriar y NO abrir tapa de radiador en caliente.',
        critical_color: 'RED',
        svg: wrapIso7000Svg('#DC2626', '<path d="M32 14v24M28 20h6M28 26h6M28 32h6"/><circle cx="32" cy="43" r="5"/><path d="M14 48c4-3 8 3 12 0M38 48c4-3 8 3 12 0M14 54c4-3 8 3 12 0c4-3 8 3 12 0c4-3 8 3 12 0"/>'),
        tags: ['diesel', 'gasoline', 'engine', 'earthmoving', 'vehicle', 'genset'],
    },
    {
        concept_id: 'iso_7000_0247_battery_charging',
        standard_family: 'ISO_7000',
        iso_reference: 'ISO 7000-0247',
        technical_name_es: 'Sistema eléctrico / Carga de alternador',
        technical_name_en: 'Battery charging condition',
        action_operator_es: 'ROJO: Falla de carga en alternador o correa; inspeccionar sistema de 12V/24V.',
        critical_color: 'RED',
        svg: wrapIso7000Svg('#DC2626', '<rect x="12" y="22" width="40" height="26"/><path d="M20 22v-5h6v5M38 22v-5h6v5M18 35h8M38 35h8M42 31v8"/>'),
        tags: ['diesel', 'electric', 'earthmoving', 'vehicle', 'genset', 'lifting'],
    },
    {
        concept_id: 'iso_7000_1409_hydraulic_oil_pressure',
        standard_family: 'ISO_7000',
        iso_reference: 'ISO 7000-1409',
        technical_name_es: 'Presión de aceite hidráulico',
        technical_name_en: 'Hydraulic oil pressure',
        action_operator_es: 'ROJO: Bajar implementos a piso, detener bomba hidráulica e inspeccionar mangueras/nivel.',
        critical_color: 'RED',
        svg: wrapIso7000Svg('#DC2626', '<path d="M32 14c0 8-10 14-10 21a10 10 0 0 0 20 0c0-7-10-13-10-21z"/><path d="M12 34h8M17 30l4 4-4 4M52 34h-8M47 30l-4 4 4 4"/>'),
        tags: ['hydraulics', 'earthmoving', 'lifting', 'underground_drill'],
    },
    {
        concept_id: 'iso_7000_1411_hydraulic_oil_temp',
        standard_family: 'ISO_7000',
        iso_reference: 'ISO 7000-1411',
        technical_name_es: 'Temperatura de aceite hidráulico',
        technical_name_en: 'Hydraulic oil temperature',
        action_operator_es: 'ÁMBAR/ROJO: Reducir ciclo de trabajo hidrostático y revisar enfriador de aceite obstruido.',
        critical_color: 'AMBER',
        svg: wrapIso7000Svg('#D97706', '<path d="M24 16c0 7-8 12-8 18a8 8 0 0 0 16 0c0-6-8-11-8-18z"/><path d="M44 16v22M44 22h5M44 28h5"/><circle cx="44" cy="43" r="4.5"/>'),
        tags: ['hydraulics', 'earthmoving', 'lifting', 'underground_drill'],
    },
    {
        concept_id: 'iso_7000_1412_hydraulic_oil_filter',
        standard_family: 'ISO_7000',
        iso_reference: 'ISO 7000-1412',
        technical_name_es: 'Restricción de filtro hidráulico',
        technical_name_en: 'Hydraulic oil filter restriction',
        action_operator_es: 'ÁMBAR: Filtro hidráulico saturado (bypass próximo); programar reemplazo en taller.',
        critical_color: 'AMBER',
        svg: wrapIso7000Svg('#D97706', '<rect x="16" y="14" width="32" height="36"/><path d="M16 32h32" stroke-dasharray="4 4"/><path d="M32 18c0 4-4 7-4 10a4 4 0 0 0 8 0c0-3-4-6-4-10z"/><path d="M32 38v8M28 43l4 4 4-4"/>'),
        tags: ['hydraulics', 'earthmoving', 'lifting', 'underground_drill'],
    },
    {
        concept_id: 'iso_7000_1410_hydraulic_oil_level',
        standard_family: 'ISO_7000',
        iso_reference: 'ISO 7000-1410',
        technical_name_es: 'Nivel de fluido hidráulico',
        technical_name_en: 'Hydraulic oil level',
        action_operator_es: 'Inspeccionar mirilla con cilindros retraídos e implemento apoyado en suelo nivelado.',
        critical_color: 'AMBER',
        svg: wrapIso7000Svg('#D97706', '<path d="M16 16v32h32V16"/><path d="M16 38h32"/><path d="M32 18c0 5-6 8-6 12a6 6 0 0 0 12 0c0-4-6-7-6-12z"/>'),
        tags: ['hydraulics', 'earthmoving', 'lifting', 'underground_drill'],
    },
    {
        concept_id: 'iso_7000_0245_fuel_level',
        standard_family: 'ISO_7000',
        iso_reference: 'ISO 7000-0245',
        technical_name_es: 'Nivel de combustible / Punto de abastecimiento',
        technical_name_en: 'Fuel level / Diesel fill',
        action_operator_es: 'Abastecer ULSD limpio con motor apagado y freno de estacionamiento aplicado.',
        critical_color: 'AMBER',
        svg: wrapIso7000Svg('#D97706', '<rect x="16" y="16" width="22" height="34"/><path d="M20 22h14v10H20zM14 50h26M38 24h5l5 6v14a3 3 0 0 1-6 0V34h-4"/>'),
        tags: ['diesel', 'gasoline', 'earthmoving', 'vehicle', 'genset', 'compressor'],
    },
    {
        concept_id: 'iso_7000_1393_water_in_fuel',
        standard_family: 'ISO_7000',
        iso_reference: 'ISO 7000-1393',
        technical_name_es: 'Agua en separador de combustible Diésel',
        technical_name_en: 'Water in fuel trap',
        action_operator_es: 'ÁMBAR: Drenar decantador primario antes de dañar inyectores Common-Rail.',
        critical_color: 'AMBER',
        svg: wrapIso7000Svg('#D97706', '<path d="M18 16h28l-4 26H22L18 16z"/><path d="M21 34h22" stroke-dasharray="3 3"/><path d="M32 42v10M28 49l4 3 4-3"/>'),
        tags: ['diesel', 'earthmoving', 'vehicle', 'genset', 'compressor'],
    },
    {
        concept_id: 'iso_7000_1168_engine_air_filter',
        standard_family: 'ISO_7000',
        iso_reference: 'ISO 7000-1168',
        technical_name_es: 'Restricción de filtro de aire de admisión',
        technical_name_en: 'Engine intake air filter restriction',
        action_operator_es: 'ÁMBAR: Reemplazar elemento primario; NUNCA golpear ni sopletear el cartucho secundario.',
        critical_color: 'AMBER',
        svg: wrapIso7000Svg('#D97706', '<rect x="18" y="22" width="28" height="20"/><path d="M18 32h28" stroke-dasharray="4 4"/><path d="M32 12v8M29 17l3 3 3-3M32 44v8"/>'),
        tags: ['diesel', 'earthmoving', 'vehicle', 'genset', 'compressor'],
    },
    {
        concept_id: 'iso_7000_2433_dpf_regeneration',
        standard_family: 'ISO_7000',
        iso_reference: 'ISO 7000-2433',
        technical_name_es: 'Filtro de partículas Diésel (DPF) / Regeneración',
        technical_name_en: 'Diesel particulate filter (DPF)',
        action_operator_es: 'ÁMBAR: Permitir ciclo de regeneración en área despejada libre de vapores inflamables.',
        critical_color: 'AMBER',
        svg: wrapIso7000Svg('#D97706', '<path d="M12 28h8l6-6h16l6 6h4v8h-4l-6 6H26l-6-6h-8z"/><circle cx="29" cy="29" r="1.5"/><circle cx="35" cy="29" r="1.5"/><circle cx="29" cy="35" r="1.5"/><circle cx="35" cy="35" r="1.5"/>'),
        tags: ['diesel_tier4', 'earthmoving', 'vehicle'],
    },
    {
        concept_id: 'iso_7000_2946_def_adblue',
        standard_family: 'ISO_7000',
        iso_reference: 'ISO 7000-2946',
        technical_name_es: 'Fluido de escape Diésel (DEF / AdBlue SCR)',
        technical_name_en: 'Diesel exhaust fluid (DEF)',
        action_operator_es: 'AZUL/ÁMBAR: Rellenar exclusivamente con urea automotriz ISO 22241 en tapa azul.',
        critical_color: 'BLUE',
        svg: wrapIso7000Svg('#0284C7', '<path d="M14 32h14l6-6h16v12H34l-6-6"/><path d="M42 20c0 4-4 6-4 9a4 4 0 0 0 8 0c0-3-4-5-4-9z"/>'),
        tags: ['diesel_tier4', 'vehicle', 'earthmoving'],
    },
    {
        concept_id: 'iso_7000_0457_glow_plug_preheat',
        standard_family: 'ISO_7000',
        iso_reference: 'ISO 7000-0457',
        technical_name_es: 'Precalentador de admisión / Bujías incandescentes',
        technical_name_en: 'Diesel engine preheat',
        action_operator_es: 'ÁMBAR: Esperar apagado del testigo antes de dar arranque en frío o gran altitud.',
        critical_color: 'AMBER',
        svg: wrapIso7000Svg('#D97706', '<path d="M12 36h8c0-10 10-10 10 0a5 5 0 0 1-10 0c0-12 16-12 16 0a5 5 0 0 1-10 0c0-12 18-12 18 0h8"/>'),
        tags: ['diesel', 'earthmoving', 'vehicle', 'genset', 'high_altitude'],
    },
    {
        concept_id: 'iso_7000_0238_parking_brake',
        standard_family: 'ISO_7000',
        iso_reference: 'ISO 7000-0238',
        technical_name_es: 'Freno de estacionamiento aplicado',
        technical_name_en: 'Parking brake',
        action_operator_es: 'ROJO: Verificar liberación antes de trasladar y activación obligatoria al estacionar + cuñas.',
        critical_color: 'RED',
        svg: wrapIso7000Svg('#DC2626', '<circle cx="32" cy="32" r="14"/><path d="M14 20a22 22 0 0 0 0 24M50 20a22 22 0 0 1 0 24M28 38V26h6a4 4 0 0 1 0 8h-6"/>'),
        tags: ['earthmoving', 'vehicle', 'lifting', 'underground_drill'],
    },
    {
        concept_id: 'iso_7000_0239_brake_system_failure',
        standard_family: 'ISO_2575',
        iso_reference: 'ISO 7000-0239 / ISO 2575',
        technical_name_es: 'Falla en sistema de frenos de servicio',
        technical_name_en: 'Brake system malfunction',
        action_operator_es: 'ROJO CRÍTICO: Detener operación inmediatamente; prohibido transitar en rampa.',
        critical_color: 'RED',
        svg: wrapIso7000Svg('#DC2626', '<circle cx="32" cy="32" r="14"/><path d="M14 20a22 22 0 0 0 0 24M50 20a22 22 0 0 1 0 24M32 25v8M32 38h.02"/>'),
        tags: ['earthmoving', 'vehicle', 'lifting'],
    },
    {
        concept_id: 'iso_7000_0249_seatbelt_reminder',
        standard_family: 'ISO_7000',
        iso_reference: 'ISO 7000-0249',
        technical_name_es: 'Cinturón de seguridad de operador / Barra ROPS',
        technical_name_en: 'Seat belt / Operator restraint',
        action_operator_es: 'ROJO: Abrochar cinturón y bajar barra de seguridad para habilitar hidráulicos de trabajo.',
        critical_color: 'RED',
        svg: wrapIso7000Svg('#DC2626', '<circle cx="32" cy="17" r="5"/><path d="M22 48v-14a10 10 0 0 1 20 0v14M18 28l28 16M18 42h28"/>'),
        tags: ['cabin_rops', 'earthmoving', 'vehicle', 'lifting'],
    },
    {
        concept_id: 'iso_7000_1156_transmission_oil_temp',
        standard_family: 'ISO_7000',
        iso_reference: 'ISO 7000-1156',
        technical_name_es: 'Temperatura de aceite de transmisión / convertidor',
        technical_name_en: 'Transmission oil temperature',
        action_operator_es: 'ROJO/ÁMBAR: Seleccionar marcha inferior en pendiente y enfriar convertidor en neutro.',
        critical_color: 'AMBER',
        svg: wrapIso7000Svg('#D97706', '<circle cx="32" cy="32" r="16" stroke-dasharray="5 3"/><path d="M32 20v16"/><circle cx="32" cy="40" r="3.5"/>'),
        tags: ['earthmoving', 'vehicle', 'lifting'],
    },
    {
        concept_id: 'iso_7000_1658_quick_coupler_lock',
        standard_family: 'ISO_7000',
        iso_reference: 'ISO 7000-1658',
        technical_name_es: 'Traba de acoplador rápido de balde / aditamento',
        technical_name_en: 'Quick coupler lock / unlock',
        action_operator_es: 'ROJO: Confirmar visualmente pasadores asegurados y ejecutar prueba de presión contra el suelo.',
        critical_color: 'RED',
        svg: wrapIso7000Svg('#DC2626', '<path d="M16 20h18l8 12-8 12H16V20z"/><circle cx="25" cy="32" r="4"/><path d="M42 32h10M48 28l4 4-4 4"/>'),
        tags: ['quick_coupler', 'earthmoving', 'lifting'],
    },
    {
        concept_id: 'iso_7000_1371_two_speed_rabbit_turtle',
        standard_family: 'ISO_7000',
        iso_reference: 'ISO 7000-1371 / 0084',
        technical_name_es: 'Selector de velocidad de traslado (Alta / Baja)',
        technical_name_en: 'Two-speed travel mode (Fast / Slow)',
        action_operator_es: 'Usar velocidad baja (Tortuga) en carguío, rampas pronunciadas y terrenos irregulares.',
        critical_color: 'AMBER',
        svg: wrapIso7000Svg('#C68346', '<path d="M14 42a16 12 0 0 1 32 0H14z"/><circle cx="49" cy="39" r="3"/><path d="M20 42v6M40 42v6M22 22h20M36 17l6 5-6 5"/>'),
        tags: ['earthmoving', 'lifting'],
    },
    {
        concept_id: 'iso_7000_1665_auxiliary_hydraulics_high_flow',
        standard_family: 'ISO_7000',
        iso_reference: 'ISO 7000-1665',
        technical_name_es: 'Circuito hidráulico auxiliar / High-Flow XPS',
        technical_name_en: 'Auxiliary hydraulic circuit / High flow',
        action_operator_es: 'Verificar presión máxima admisible del aditamento antes de activar caudal continuo.',
        critical_color: 'AMBER',
        svg: wrapIso7000Svg('#00AEEF', '<path d="M16 20v24M48 20v24M16 26h32M16 38h32M28 22l6 4-6 4M36 34l-6 4 6 4"/>'),
        tags: ['hydraulics', 'quick_coupler', 'earthmoving', 'underground_drill'],
    },
    {
        concept_id: 'iso_7000_0791_grease_lubrication_point',
        standard_family: 'ISO_7000',
        iso_reference: 'ISO 7000-0791',
        technical_name_es: 'Punto de engrase por grasera (Pasadores y bujes)',
        technical_name_en: 'Grease lubrication point',
        action_operator_es: 'Limpiar grasera antes de inyectar grasa NLGI #2 con disulfuro de molibdeno según pauta.',
        critical_color: 'NONE',
        svg: wrapIso7000Svg('#C68346', '<rect x="16" y="24" width="20" height="22"/><path d="M26 24v-8l14-4M36 34h10l4 6M14 18l8 6"/>'),
        tags: ['earthmoving', 'lifting', 'underground_drill', 'vehicle', 'power_tool'],
    },
    {
        concept_id: 'iso_7000_0029_horn_audible_warning',
        standard_family: 'ISO_7000',
        iso_reference: 'ISO 7000-0029',
        technical_name_es: 'Bocina / Código acústico de maniobra en faena',
        technical_name_en: 'Horn / Audible warning',
        action_operator_es: '1 toque antes de arrancar motor, 2 toques antes de avanzar, 3 toques antes de retroceder.',
        critical_color: 'NONE',
        svg: wrapIso7000Svg('#00AEEF', '<path d="M14 28h12l16-10v28L26 36H14V28zM48 24a10 10 0 0 1 0 16"/>'),
        tags: ['earthmoving', 'vehicle', 'lifting', 'underground_drill'],
    },
    {
        concept_id: 'iso_7000_1141_beacon_strobe_light',
        standard_family: 'ISO_7000',
        iso_reference: 'ISO 7000-1141',
        technical_name_es: 'Baliza estroboscópica de operación minera',
        technical_name_en: 'Rotating / flashing beacon',
        action_operator_es: 'Mantener encendida permanentemente dentro de área mina, cantera o patio industrial.',
        critical_color: 'AMBER',
        svg: wrapIso7000Svg('#D97706', '<path d="M22 46h20l-2-16a8 8 0 0 0-16 0l-2 16zM18 46h28M32 14v6M16 24l5 3M48 24l-5 3"/>'),
        tags: ['earthmoving', 'vehicle', 'lifting', 'underground_drill'],
    },
    {
        concept_id: 'iso_7000_0639_master_battery_disconnect',
        standard_family: 'ISO_7000',
        iso_reference: 'ISO 7000-0639 / 2063',
        technical_name_es: 'Cortacorriente maestro / Aislamiento eléctrico LOTO',
        technical_name_en: 'Battery disconnect switch',
        action_operator_es: 'Abrir cortacorriente al finalizar turno e instalar pinza y candado personal en mantención.',
        critical_color: 'RED',
        svg: wrapIso7000Svg('#DC2626', '<circle cx="20" cy="40" r="4"/><circle cx="44" cy="40" r="4"/><path d="M23 37l18-14M12 40h4M48 40h4M32 14v8"/>'),
        tags: ['earthmoving', 'vehicle', 'lifting', 'genset', 'compressor', 'underground_drill'],
    },
    {
        concept_id: 'iso_2575_check_engine_mil',
        standard_family: 'ISO_2575',
        iso_reference: 'ISO 2575-F01 / ISO 7000-0640',
        technical_name_es: 'Falla electrónica de motor (Check Engine / ECM)',
        technical_name_en: 'Engine malfunction indicator (MIL)',
        action_operator_es: 'ÁMBAR: Leer código DTC activo en monitor; si parpadea o pasa a rojo, detener motor.',
        critical_color: 'AMBER',
        svg: wrapIso7000Svg('#D97706', '<path d="M14 28h6v-4h16l6 6h8v12h-8l-4 4H22l-4-4h-4V28zM24 24v-5M20 19h8M10 34h4"/>'),
        tags: ['diesel', 'gasoline', 'earthmoving', 'vehicle', 'genset'],
    },
    {
        concept_id: 'iso_2575_four_wheel_drive_4wd',
        standard_family: 'ISO_2575',
        iso_reference: 'ISO 2575 / ISO 7000-2412',
        technical_name_es: 'Tracción 4x4 / Bloqueo diferencial de faena',
        technical_name_en: 'Four-wheel drive / Differential lock',
        action_operator_es: 'Conectar 4H/4L con vehículo detenido o a baja velocidad según pendiente y adherencia.',
        critical_color: 'AMBER',
        svg: wrapIso7000Svg('#C68346', '<rect x="14" y="16" width="8" height="12"/><rect x="42" y="16" width="8" height="12"/><rect x="14" y="36" width="8" height="12"/><rect x="42" y="36" width="8" height="12"/><path d="M22 22h20M22 42h20M32 22v20"/><circle cx="32" cy="32" r="3"/>'),
        tags: ['vehicle', 'high_altitude'],
    },
    {
        concept_id: 'iso_2575_tpms_tire_pressure',
        standard_family: 'ISO_2575',
        iso_reference: 'ISO 2575-G03 / ISO 7000-1435',
        technical_name_es: 'Baja presión o sobretemperatura de neumáticos',
        technical_name_en: 'Tire pressure monitoring (TPMS)',
        action_operator_es: 'ÁMBAR: Inspeccionar cortes laterales y presión en frío con jaula de inflado si aplica.',
        critical_color: 'AMBER',
        svg: wrapIso7000Svg('#D97706', '<path d="M20 18c-6 8-6 20 0 28h24c6-8 6-20 0-28M22 46h20"/><path d="M32 24v10M32 39h.02"/>'),
        tags: ['vehicle', 'earthmoving', 'lifting'],
    },
    {
        concept_id: 'iso_7000_pneumatic_air_pressure',
        standard_family: 'ISO_7000',
        iso_reference: 'ISO 7000-1405',
        technical_name_es: 'Presión de red neumática / Lubricador en línea',
        technical_name_en: 'Pneumatic air pressure & lubricator',
        action_operator_es: 'Verificar presión 0.5–0.63 MPa, cadenas antilatigazo (whipcheck) y nivel de aceite en pato.',
        critical_color: 'AMBER',
        svg: wrapIso7000Svg('#00AEEF', '<circle cx="32" cy="32" r="14"/><path d="M32 32l8-8M12 48h40M20 14h24"/>'),
        tags: ['pneumatic', 'underground_drill', 'compressor'],
    },

    // ── IEC 60417: Herramientas Eléctricas, Tableros, Soldadoras y Equipos HV ──
    {
        concept_id: 'iec_60417_5172_class_ii_double_insulation',
        standard_family: 'IEC_60417',
        iso_reference: 'IEC 60417-5172',
        technical_name_es: 'Equipo Clase II — Doble aislamiento eléctrico',
        technical_name_en: 'Class II equipment (Double insulated)',
        action_operator_es: 'Inspeccionar carcasa aislante y cable íntegro sin empalmes hechizos antes de conectar.',
        critical_color: 'BLUE',
        svg: wrapIso7000Svg('#0284C7', '<rect x="14" y="14" width="36" height="36"/><rect x="23" y="23" width="18" height="18"/>'),
        tags: ['power_tool', 'electric_class_ii'],
    },
    {
        concept_id: 'iec_60417_5019_protective_earth',
        standard_family: 'IEC_60417',
        iso_reference: 'IEC 60417-5019',
        technical_name_es: 'Tierra de protección (PE)',
        technical_name_en: 'Protective earth (ground)',
        action_operator_es: 'Verificar conexión firme a malla/barra de tierra y protector diferencial 30 mA operativo.',
        critical_color: 'GREEN',
        svg: wrapIso7000Svg('#16A34A', '<circle cx="32" cy="32" r="18"/><path d="M32 16v16M20 32h24M24 38h16M28 44h8"/>'),
        tags: ['genset', 'welder', 'compressor', 'electric_hv', 'stationary'],
    },
    {
        concept_id: 'iec_60417_5032_alternating_current_ac',
        standard_family: 'IEC_60417',
        iso_reference: 'IEC 60417-5032',
        technical_name_es: 'Alimentación en Corriente Alterna (AC 220V / 380V)',
        technical_name_en: 'Alternating current (AC)',
        action_operator_es: 'Confirmar tensión y frecuencia nominal de placa antes de energizar el equipo.',
        critical_color: 'AMBER',
        svg: wrapIso7000Svg('#D97706', '<path d="M12 32c6-12 14-12 20 0s14 12 20 0"/>'),
        tags: ['power_tool', 'genset', 'welder', 'compressor', 'stationary'],
    },
    {
        concept_id: 'iec_60417_5031_direct_current_dc',
        standard_family: 'IEC_60417',
        iso_reference: 'IEC 60417-5031',
        technical_name_es: 'Corriente Continua (DC / Baterías Li-Ion o Soldadura)',
        technical_name_en: 'Direct current (DC)',
        action_operator_es: 'Respetar polaridad (+/-) y usar cargador original certificado.',
        critical_color: 'BLUE',
        svg: wrapIso7000Svg('#0284C7', '<path d="M14 26h36M14 38h8M28 38h8M42 38h8"/>'),
        tags: ['power_tool', 'welder', 'electric_hv'],
    },
    {
        concept_id: 'iec_60417_5036_dangerous_voltage',
        standard_family: 'IEC_60417',
        iso_reference: 'IEC 60417-5036',
        technical_name_es: 'Tensión eléctrica peligrosa / Arco eléctrico',
        technical_name_en: 'Dangerous voltage',
        action_operator_es: 'ROJO: Intervención exclusiva por electricista autorizado con ausencia de tensión verificada.',
        critical_color: 'RED',
        svg: wrapIso7000Svg('#DC2626', '<path d="M35 12L21 34h11l-4 18 16-23H33l2-17z"/>'),
        tags: ['genset', 'welder', 'electric_hv', 'stationary'],
    },

    // ── GHS (SGA): Pictogramas de Fluidos Operativos, Combustibles y Químicos ──
    {
        concept_id: 'ghs_02_flammable_liquids',
        standard_family: 'GHS',
        iso_reference: 'GHS02',
        technical_name_es: 'SGA GHS02 — Combustibles y solventes inflamables',
        technical_name_en: 'GHS02 Flammable',
        action_operator_es: 'Mantener lejos de chispas/superficies calientes; disponer bandeja antiderrame.',
        critical_color: 'RED',
        svg: wrapGhsDiamondSvg('<path d="M32 18c4 6 8 10 8 16a8 8 0 0 1-16 0c0-4 2-7 4-10c0 3 2 4 4 2c0-3 0-6 0-8zM22 46h20"/>'),
        tags: ['diesel', 'gasoline', 'earthmoving', 'vehicle', 'genset', 'hydromet'],
    },
    {
        concept_id: 'ghs_04_compressed_gas',
        standard_family: 'GHS',
        iso_reference: 'GHS04',
        technical_name_es: 'SGA GHS04 — Gases comprimidos / Acumuladores N2',
        technical_name_en: 'GHS04 Gas under pressure',
        action_operator_es: 'Asegurar cilindros con cadena y verificar válvulas en acumuladores hidroneumáticos.',
        critical_color: 'RED',
        svg: wrapGhsDiamondSvg('<rect x="27" y="18" width="10" height="28" rx="4"/><path d="M30 18v-3h4v3"/>'),
        tags: ['pneumatic', 'welder', 'hydraulics', 'underground_drill'],
    },
    {
        concept_id: 'ghs_05_corrosive_battery_acid',
        standard_family: 'GHS',
        iso_reference: 'GHS05',
        technical_name_es: 'SGA GHS05 — Corrosivo (Electrolito batería / Ácidos)',
        technical_name_en: 'GHS05 Corrosive',
        action_operator_es: 'Usar antiparras herméticas y guantes resistentes a ácidos al revisar baterías.',
        critical_color: 'RED',
        svg: wrapGhsDiamondSvg('<path d="M22 22l6 6M42 22l-6 6M20 42h24M32 32v8"/>'),
        tags: ['diesel', 'electric_hv', 'vehicle', 'earthmoving', 'hydromet'],
    },
    {
        concept_id: 'ghs_07_irritant_sensitizer',
        standard_family: 'GHS',
        iso_reference: 'GHS07',
        technical_name_es: 'SGA GHS07 — Irritante dérmico/ocular (Aceites y grasas)',
        technical_name_en: 'GHS07 Harmful / Irritant',
        action_operator_es: 'Usar guantes de nitrilo al manipular aceites usados, refrigerantes y desengrasantes.',
        critical_color: 'RED',
        svg: wrapGhsDiamondSvg('<path d="M32 20v15" stroke-width="4.5"/><circle cx="32" cy="43" r="2.5"/>'),
        tags: ['hydraulics', 'diesel', 'earthmoving', 'vehicle', 'genset', 'compressor'],
    },
    {
        concept_id: 'ghs_08_health_hazard_silica_fumes',
        standard_family: 'GHS',
        iso_reference: 'GHS08',
        technical_name_es: 'SGA GHS08 — Peligro respiratorio crónico (Sílice / Humos Diésel)',
        technical_name_en: 'GHS08 Health hazard (Silica / DPM)',
        action_operator_es: 'Exigir humectación/captación de polvo y protección P100 en perforación, corte o desbaste.',
        critical_color: 'RED',
        svg: wrapGhsDiamondSvg('<circle cx="32" cy="22" r="4.5"/><path d="M24 44v-9a8 8 0 0 1 16 0v9"/><polygon points="32,30 34,35 39,35 35,38 36,43 32,40 28,43 29,38 25,35 30,35" fill="#FFFFFF" stroke="none"/>'),
        tags: ['underground_drill', 'power_tool', 'welder', 'diesel', 'earthmoving'],
    },
    {
        concept_id: 'ghs_09_environmental_spill_hazard',
        standard_family: 'GHS',
        iso_reference: 'GHS09',
        technical_name_es: 'SGA GHS09 — Peligro ambiental por derrame de hidrocarburos',
        technical_name_en: 'GHS09 Environmental hazard',
        action_operator_es: 'Portar kit antiderrame en terreno y segregar residuos peligrosos (RESPEL DS 148).',
        critical_color: 'RED',
        svg: wrapGhsDiamondSvg('<path d="M24 42V24M24 30l-5-4M24 27l5-4M20 42h24M36 37c3-2 6 0 7 2c-2 2-5 3-7 1z"/>'),
        tags: ['diesel', 'hydraulics', 'earthmoving', 'vehicle', 'genset'],
    },
];

let seedPromise: Promise<{ seededIso7010: number; seededTechnical: number }> | null = null;
let alreadyVerifiedInMemory = false;

function mapIso7010CriticalColor(category: Sign['category']): 'RED' | 'AMBER' | 'GREEN' | 'BLUE' {
    switch (category) {
        case 'mandatory':
            return 'BLUE';
        case 'warning':
            return 'AMBER';
        case 'prohibition':
        case 'fire':
            return 'RED';
        case 'emergency':
            return 'GREEN';
    }
}

/**
 * Vectoriza automáticamente un ícono raster recortado (PNG/JPEG/WebP) hacia `.svg` puro
 * empleando `@visioncortex/vtracer` WASM + optimización `svgo` (`MediaDigestorServer.digestSvg`).
 */
export async function vectorizeRasterSymbolToSvg(
    rasterBuffer: Buffer,
    options: { mode?: 'bw' | 'poster'; palette?: string[] } = {}
): Promise<{ svgString: string; descriptorUrl: string; sha256: string }> {
    const mode = options.mode || 'poster';
    const rawSvg = convertBuffer(new Uint8Array(rasterBuffer), {
        preset: mode === 'bw' ? 'bw' : 'poster',
        clustering: mode === 'bw' ? 'bw' : 'color-cluster',
        mode: 'spline',
        filterSpeckle: 6,
        cornerThreshold: 55,
        simplify: 1.4,
        maxColors: options.palette ? undefined : 5,
        palette: options.palette,
        optimize: 2,
    });

    const digested = await MediaDigestorServer.digestSvg(rawSvg);
    const persisted = await CasStorageService.persistDigestedBinary(digested, {
        scope: 'SYMBOLOGY_MASTER',
        actorUid: 'vtracer-wasm-engine',
        originalFilename: `vtracer_${digested.sha256.slice(0, 10)}.svg`,
    });

    return {
        svgString: digested.buffer.toString('utf8'),
        descriptorUrl: persisted.downloadUrl,
        sha256: persisted.sha256,
    };
}

/**
 * Siembra idempotente del catálogo universal `.svg` en `master_symbology_vault`.
 * Se ejecuta una sola vez por proceso (o bajo demanda desde API) sin sobrescribir variantes humanas.
 */
export async function ensureUniversalSymbologySeeded(
    forceFullIso7010: boolean = false
): Promise<{ seededIso7010: number; seededTechnical: number }> {
    if (alreadyVerifiedInMemory && !forceFullIso7010) {
        return { seededIso7010: 0, seededTechnical: 0 };
    }
    if (seedPromise) return seedPromise;

    seedPromise = (async () => {
        try {
            // Comprobar marcador rápido para evitar re-escrituras si ya está sembrado
            const sentinelSnap = await db
                .collection('master_symbology_vault')
                .doc('iso_7000_0248_engine_oil_pressure')
                .get();
            const iso7010Sentinel = await db
                .collection('master_symbology_vault')
                .doc('iso_7010_m002')
                .get();

            if (sentinelSnap.exists && iso7010Sentinel.exists && !forceFullIso7010) {
                alreadyVerifiedInMemory = true;
                return { seededIso7010: 0, seededTechnical: 0 };
            }

            const nowIso = new Date().toISOString();
            let seededIso7010 = 0;
            let seededTechnical = 0;

            // 1. Sembrar símbolos técnicos ISO 7000 / ISO 2575 / IEC 60417 / GHS
            let batch = db.batch();
            let ops = 0;

            for (const item of CURATED_MACHINERY_AND_ELECTRICAL_SEEDS) {
                const digested = await MediaDigestorServer.digestSvg(item.svg);
                const cas = await CasStorageService.persistDigestedBinary(digested, {
                    scope: 'SYMBOLOGY_MASTER',
                    actorUid: 'universal-symbology-seed',
                    originalFilename: `${item.concept_id}.svg`,
                });

                const ref = db.collection('master_symbology_vault').doc(item.concept_id);
                batch.set(
                    ref,
                    {
                        concept_id: item.concept_id,
                        standard_family: item.standard_family,
                        iso_reference: item.iso_reference,
                        technical_name_es: item.technical_name_es,
                        technical_name_en: item.technical_name_en,
                        description_es: item.action_operator_es,
                        description_en: item.technical_name_en,
                        action_operator_es: item.action_operator_es,
                        critical_color: item.critical_color,
                        standard_icon_status: 'encontrado',
                        standard_icon_url: cas.downloadUrl,
                        svg_inline: digested.buffer.toString('utf8'),
                        cas_sha256: cas.sha256,
                        tags: item.tags,
                        created_at: nowIso,
                        created_by: 'MINREPORT UniversalSymbologySeed v4.0',
                        updated_at: nowIso,
                    },
                    { merge: true }
                );
                seededTechnical++;
                ops++;
                if (ops >= 350) {
                    await batch.commit();
                    batch = db.batch();
                    ops = 0;
                }
            }

            // 2. Sembrar señales ISO 7010 desde `@iso-safety-signs/core`
            const allIso7010 = getAllSigns();
            const signsToSeed = forceFullIso7010
                ? allIso7010
                : allIso7010.filter(
                      (s) =>
                          Boolean(ISO_7010_ES_TRANSLATIONS[s.code.toUpperCase()]) ||
                          ['M', 'W', 'P', 'F', 'E'].includes(s.code[0]?.toUpperCase() || '')
                  );

            for (const sign of signsToSeed) {
                const codeUpper = sign.code.toUpperCase();
                const docId = `iso_7010_${codeUpper.toLowerCase()}`;
                const localized = ISO_7010_ES_TRANSLATIONS[codeUpper];
                const nameEs = localized ? `${codeUpper} — ${localized.nameEs}` : `ISO 7010 ${codeUpper} — ${sign.name}`;
                const actionEs = localized ? localized.actionEs : sign.description;

                // Para las 47 señales industriales clave, persistimos además su archivo `.svg` limpio en CAS;
                // para las restantes ~285 de ISO 7010 dejamos `svg_inline` + data URI/CAS bajo demanda para arranque instantáneo (< 600ms)
                let iconUrl: string;
                let cleanSvg = sign.svg;

                if (localized || forceFullIso7010) {
                    const digested = await MediaDigestorServer.digestSvg(sign.svg);
                    cleanSvg = digested.buffer.toString('utf8');
                    const cas = await CasStorageService.persistDigestedBinary(digested, {
                        scope: 'SYMBOLOGY_MASTER',
                        actorUid: 'iso-7010-seed',
                        originalFilename: `ISO_7010_${codeUpper}.svg`,
                    });
                    iconUrl = cas.downloadUrl;
                } else {
                    iconUrl = `data:image/svg+xml;utf8,${encodeURIComponent(sign.svg)}`;
                }

                const ref = db.collection('master_symbology_vault').doc(docId);
                batch.set(
                    ref,
                    {
                        concept_id: docId,
                        standard_family: 'ISO_7010',
                        iso_code: codeUpper,
                        iso_category: sign.category,
                        iso_reference: `ISO 7010-${codeUpper}`,
                        technical_name_es: nameEs,
                        technical_name_en: sign.name,
                        description_es: actionEs,
                        description_en: sign.description,
                        action_operator_es: actionEs,
                        critical_color: mapIso7010CriticalColor(sign.category),
                        standard_icon_status: 'encontrado',
                        standard_icon_url: iconUrl,
                        ...(cleanSvg.length <= 24000 ? { svg_inline: cleanSvg } : {}),
                        created_at: nowIso,
                        created_by: 'MINREPORT ISO-7010 Registry v4.0',
                        updated_at: nowIso,
                    },
                    { merge: true }
                );
                seededIso7010++;
                ops++;

                if (ops >= 350) {
                    await batch.commit();
                    batch = db.batch();
                    ops = 0;
                }
            }

            if (ops > 0) {
                await batch.commit();
            }

            alreadyVerifiedInMemory = true;
            return { seededIso7010, seededTechnical };
        } finally {
            seedPromise = null;
        }
    })();

    return seedPromise;
}
