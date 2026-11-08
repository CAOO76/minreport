import type { ExtractedFigureRef, ItemizedSource } from '../types/vault';

/**
 * PENDING FIGURE MARKERS v3 (Frontend) — Espejo 1:1 de `src/modules/opermaq/services/PendingFigureMarkers.ts`.
 *
 * 1. Parser resiliente (`parsePendingMarker` + `normalizeBrokenPendingMarkersInMarkdown`) que repara marcadores
 *    truncados sin `](url)`, con corchetes internos o paréntesis en la URL, vinculándolos a la fuente HTTPS verificada.
 * 2. Sanitización de figuras no citadas (`sanitizeMarkdownFiguresAndBrokenMarkers`): elimina gráficos automáticos
 *    de tablas (`Comparativa de magnitudes`) y fotos comerciales de repuestos sueltos no mencionadas en la sección.
 * 3. Inyección por sección (`injectLegacyPendingMarkers`): asegura que toda sección con referencia visual explícita
 *    y sin figura legítima muestre su tarjeta interactiva `PendingSectionFigureCard` con link fuente, carga in-situ y `"ACTUALIZAR"`.
 */

export const PENDING_MARKER_LINE_REGEX = /^!\[IMAGEN[_\s-]PENDIENTE:\s*([^\]]+)\]\(([^)]*)\)$/i;
export const PENDING_MARKER_GLOBAL_REGEX = /!?\[IMAGEN[_\s-]PENDIENTE:\s*[^\n]*?(?:\]\([^)\n]*\)|\]|$)/gi;
export const NO_SOURCE_URL = '#sin-fuente';

const STOPWORDS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'en', 'y', 'e', 'o', 'u', 'a', 'al', 'un', 'una', 'con', 'por', 'para',
  'que', 'se', 'su', 'sus', 'es', 'lo', 'le', 'como', 'sin', 'sobre', 'entre', 'hasta', 'desde', 'the', 'and',
  'of', 'to', 'in', 'on', 'for', 'with',
]);

const GENERIC_FIGURE_SUBJECT_WORDS = new Set([
  'conjunto', 'vista', 'unidad', 'unidades', 'motor', 'diesel', 'cat', 'caterpillar', 'sistema', 'sistemas',
  'componente', 'componentes', 'equipo', 'equipos', 'serie', 'modelo', 'figura', 'tecnica', 'tecnico',
  'esquema', 'diagrama', 'plano', 'curva', 'grafico', 'mapa', 'ilustracion', 'imagen', 'fotografia', 'foto',
  'real', 'referencia', 'ubicacion', 'general', 'detalle', 'comparativa', 'magnitudes', 'parametrico',
  'parametrica', 'oem', 'montaje', 'soporte', 'superior', 'inferior', 'lateral', 'frontal', 'trasero',
  'izquierdo', 'derecho', 'interna', 'externa', 'principal', 'auxiliar', 'industrial', 'minero', 'activo',
]);

const SPARE_PART_PACKSHOT_REGEX =
  /\b(?:conjunto\s+de\s+filtro|filtro\s+separador\s+de\s+agua|carcasa\s+de\s+(?:filtro|bomba)|con\s+arn[eé]s\s+y\s+herrajes|casquillos\s+met[aá]licos|aisladores\s+elast[oó]meros|kit\s+de\s+(?:sellos|reparaci[oó]n|empaquetaduras)|repuesto\s+aislado|empaquetadura\s+suelta)\b/i;

const IMPERATIVE_VERBS = new Set([
  'retire', 'inserte', 'conecte', 'instale', 'empuje', 'verifique', 'revise', 'gire', 'presione', 'suelte',
  'levante', 'baje', 'apague', 'encienda', 'coloque', 'asegure', 'desconecte', 'limpie', 'drene', 'llene', 'mida',
  'ajuste', 'apriete', 'afloje', 'abra', 'cierre', 'active', 'desactive', 'compruebe', 'inspeccione', 'reemplace',
  'lubrique', 'engrase', 'purgue', 'accione', 'mueva', 'tire', 'detenga', 'arranque', 'espere', 'registre',
  'confirme', 'seleccione', 'pulse', 'utilice', 'use', 'aplique', 'monte', 'desmonte', 'cambie', 'calibre',
  'mantenga', 'evite', 'libere', 'regule', 'observe', 'reduzca', 'aumente', 'desplace', 'estacione', 'bloquee',
  'asegurese', 'situase', 'ubique', 'posicione', 'compruebese',
  'remove', 'install', 'connect', 'check', 'push', 'pull', 'turn', 'press', 'release',
]);

const PROCEDURAL_STEP_WORDS = new Set([
  'paso', 'etapa', 'fase', 'nivel', 'categoria', 'condicion', 'modo', 'estado', 'nota', 'advertencia', 'peligro',
  'precaucion', 'atencion', 'maniobra', 'secuencia', 'prueba', 'verificacion', 'chequeo', 'inspeccion', 'accion',
  'operacion', 'arranque', 'parada', 'detencion', 'antes', 'despues', 'durante', 'cuando', 'siempre', 'nunca',
  'jamas', 'evitar', 'mantener', 'comprobar', 'verificar', 'asegurar', 'asegurarse', 'colocar', 'aplicar',
  'seleccionar', 'presionar', 'accionar', 'girar', 'levantar', 'bajar', 'detener', 'arrancar', 'encender',
  'apagar', 'conectar', 'desconectar', 'retirar', 'instalar', 'liberar', 'esperar', 'ajustar', 'regular',
  'observar', 'confirmar', 'reducir', 'aumentar', 'desplazar', 'estacionar', 'bloquear', 'revisar', 'inspeccionar',
  'lubricar', 'engrasar', 'purgar', 'drenar', 'llenar', 'medir', 'limpiar', 'abrir', 'cerrar', 'activar',
  'desactivar', 'utilizar', 'usar', 'cambiar', 'reemplazar', 'calibrar', 'montar', 'desmontar', 'empujar', 'tirar',
]);

const TECHNICAL_NOUNS_ENDING_IN_AR_ER_IR = new Set([
  'motor', 'rotor', 'estator', 'sensor', 'radiador', 'alternador', 'acumulador', 'enfriador', 'separador',
  'ventilador', 'silenciador', 'amortiguador', 'convertidor', 'bastidor', 'acoplador', 'indicador', 'interruptor',
  'selector', 'conector', 'reductor', 'limitador', 'regulador', 'actuador', 'alimentador', 'lubricador',
  'estrangulador', 'condensador', 'evaporador', 'compresor', 'inyector', 'transmisor', 'receptor', 'elevador',
  'cargador', 'respirador', 'extintor', 'disyuntor', 'contactor', 'aislador', 'esparcidor', 'bastidor',
]);

function isProceduralVerbOrStepWord(normWord: string): boolean {
  if (!normWord) return true;
  if (IMPERATIVE_VERBS.has(normWord) || PROCEDURAL_STEP_WORDS.has(normWord)) return true;
  if (
    /^[a-z]{4,}(?:ar|er|ir|arse|erse|irse)$/.test(normWord) &&
    !TECHNICAL_NOUNS_ENDING_IN_AR_ER_IR.has(normWord)
  ) {
    return true;
  }
  return false;
}

const NON_PORT_UPPER_CODES = new Set([
  'ISO', 'SAE', 'DIN', 'IEC', 'EN', 'API', 'OEM', 'ROPS', 'FOPS', 'SI', 'HP', 'KW', 'RPM', 'CAT', 'XHP', 'PSI',
  'BAR', 'KPA', 'MPA', 'GPM', 'NLGI', 'ASTM', 'ANSI', 'DEF', 'PDF', 'URL', 'SIS', 'EPA', 'CE', 'UE', 'EU', 'US',
  'CL', 'MM', 'CM', 'KG', 'LB', 'NM', 'VDC', 'VAC', 'AC', 'DC', 'LED', 'IA', 'AI', 'HITL', 'CAS', 'SKU', 'ID',
  'DEO', 'TDTO', 'HYDO', 'FDAO', 'ELC', 'SOS', 'CMRP', 'RCM', 'LOTO', 'PM', 'SMU', 'HRC', 'PPM', 'CST',
  'CK', 'CJ', 'CI', 'DOT', 'GL', 'TO', 'QT',
  'HSEC', 'IPER', 'AST', 'ART', 'PTS', 'PETS', 'EPP', 'PPE', 'PREXOR', 'PLANESI', 'TMERT', 'MMC', 'HAVS', 'WBV',
  'DPM', 'LPP', 'LPA', 'LPT', 'TWA', 'STEL', 'IDLH', 'NFPA', 'OSHA', 'MSHA', 'NIOSH', 'ACGIH', 'GHS', 'PQS',
  'AFEX', 'NCH', 'DS', 'NOx', 'NOX', 'CO',
  'CUMPLE', 'NOCUMPLE', 'PASA', 'NOPASA', 'OK', 'OBD', 'VIMS', 'TPMS', 'TKPH', 'TBC', 'ESOF', 'DRW', 'PTO', 'RAX',
  'ARC', 'ADD', 'FULL', 'MIN', 'MAX',
]);

const NON_PORT_ALPHANUM_CODE_REGEX =
  /^(?:PM\d+|M\d{1,2}|W\d{2}|G\d|S\d|T\d|F\d{1,2}|GL\d|TO\d|CI\d|CJ\d|CK\d|N2|O2|H2|CO2|NO2|SO2|H2S|CH4|IP\d{2}[A-Z]?|Z87|Z89|P3|P100|[LREG][1-5]|[24][HL]|TA1)$/i;

const UNIT_WORD = /^(?:mm|cm|m|in|ft|psi|bar|kpa|mpa|l\/min|gpm|kg|lb|hp|kw|v|a|hz|rpm|°c|°f|nm|n·m|l|gal|qt|ppm|cst|µm|db|dba|lux)$/i;

const EXPLICIT_VISUAL_PHRASE =
  /\b(?:seg[uú]n\s+(?:el|la|los|las)?\s*(?:esquema|diagrama|plano|figura|ilustraci[oó]n|imagen|curva)|ver\s+(?:el|la)?\s*(?:esquema|diagrama|figura|ilustraci[oó]n|imagen|plano|curva)|(?:ilustrad[oa]s?|indicad[oa]s?|mostrad[oa]s?|se[nñ]alad[oa]s?|representad[oa]s?)\s+en\s+(?:el|la)\s+(?:figura|diagrama|esquema|ilustraci[oó]n|plano|curva)|ubicaci[oó]n\s+en\s+(?:el|la)?\s*(?:diagrama|esquema|figura)|\b(?:fig\.|figura)\s*\d+)/i;

export function normalizeTechText(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[`*_]/g, ' ')
    .replace(/[^a-z0-9/\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function technicalTokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const tok of normalizeTechText(s).split(/[\s/]+/)) {
    if (!tok || STOPWORDS.has(tok)) continue;
    if (tok.length >= 3 || /^[a-z]{1,2}\d{1,2}$/.test(tok)) out.add(tok);
  }
  return out;
}

export function subjectTokensFromFigureTitle(titleEs: string): string[] {
  const out: string[] = [];
  for (const tok of technicalTokens(titleEs)) {
    if (GENERIC_FIGURE_SUBJECT_WORDS.has(tok)) continue;
    if (/^\d+$/.test(tok)) continue;
    out.push(tok);
  }
  return out;
}

export function tokenContainment(a: string, b: string): number {
  const setA = technicalTokens(a);
  const setB = technicalTokens(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  return inter / setA.size;
}

export function isPortCode(rawToken: string): boolean {
  const token = String(rawToken || '').replace(/[`'"*]/g, '').trim();
  if (!token || token.length > 5) return false;
  if (STOPWORDS.has(token.toLowerCase())) return false;
  if (NON_PORT_ALPHANUM_CODE_REGEX.test(token)) return false;
  if (/^[A-Za-z]{1,3}\d{1,2}[A-Za-z]?$/.test(token)) return true;
  if (/^[A-Z]{2,4}$/.test(token) && !NON_PORT_UPPER_CODES.has(token)) return true;
  return false;
}

const CALLOUT_CUT_WORDS = new Set(['y', 'e', 'o', 'u', 'que', 'and', 'or', 'para', 'con', 'sobre', 'en']);

function truncateCalloutLabel(label: string): string {
  const out: string[] = [];
  for (const word of label.split(' ')) {
    const norm = normalizeTechText(word);
    if (out.length > 0 && (CALLOUT_CUT_WORDS.has(norm) || IMPERATIVE_VERBS.has(norm))) break;
    out.push(word);
    if (out.length >= 4) break;
  }
  return out.join(' ');
}

function cleanCalloutLabel(label: string): string {
  return label.replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim();
}

export function extractDiagramCallouts(sectionText: string): string[] {
  const text = String(sectionText || '').replace(PENDING_MARKER_GLOBAL_REGEX, ' ');
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (val: string) => {
    const clean = cleanCalloutLabel(val);
    const key = clean.toLowerCase();
    if (clean.length >= 2 && !seen.has(key)) {
      seen.add(key);
      found.push(clean);
    }
  };

  const numberedRegex = /\((\d{1,2})\)\s+`?([^\n,;.()`]{2,60})/g;
  let m: RegExpExecArray | null;
  while ((m = numberedRegex.exec(text)) !== null) {
    const label = truncateCalloutLabel(cleanCalloutLabel(m[2]));
    const firstWord = normalizeTechText(label.split(' ')[0] || '');
    if (!firstWord || isProceduralVerbOrStepWord(firstWord) || UNIT_WORD.test(firstWord) || STOPWORDS.has(firstWord)) continue;
    if (/^\d/.test(firstWord)) continue;
    push(`(${m[1]}) ${label}`);
  }

  const portRegex =
    /\b(p[oó]rticos?|recept[aá]culos?|conectores?|terminales?|tomas?\s+de\s+presi[oó]n|lumbreras?|v[aá]lvulas?)\s+((?:[`'"]?[A-Za-z0-9]{1,5}[`'"]?)(?:\s*(?:\/|,|\by\b|\be\b)\s*[`'"]?[A-Za-z0-9]{1,5}[`'"]?)*)/gi;
  while ((m = portRegex.exec(text)) !== null) {
    const keyword = m[1];
    const codes = m[2]
      .split(/\s*(?:\/|,|\by\b|\be\b)\s*/)
      .map((c) => c.replace(/[`'"]/g, '').trim())
      .filter((c) => isPortCode(c));
    if (codes.length > 0) push(`${keyword} ${codes.join('/')}`);
  }

  const backtickRegex = /`([A-Za-z]{1,2}\d{1,2})`/g;
  while ((m = backtickRegex.exec(text)) !== null) {
    const code = m[1];
    if (NON_PORT_ALPHANUM_CODE_REGEX.test(code)) continue;
    if (!found.some((f) => f.split(/[\s/]+/).includes(code))) push(code);
  }

  return found.slice(0, 8);
}

export function hasExplicitVisualReference(sectionText: string): boolean {
  const text = String(sectionText || '').replace(PENDING_MARKER_GLOBAL_REGEX, ' ');
  if (EXPLICIT_VISUAL_PHRASE.test(text)) return true;
  return extractDiagramCallouts(text).length >= 2;
}

export interface MarkdownSection {
  heading: string;
  lines: string[];
}

function isSubHeadingLine(trimmed: string): boolean {
  if (/^#{1,4}\s+\S/.test(trimmed)) return true;
  if (/^\*\*\d{1,2}[.)]\s+.{3,180}\*\*:?$/.test(trimmed)) return true;
  if (/^\d{1,2}[.)]\s+\*\*.{3,180}\*\*:?$/.test(trimmed)) return true;
  return false;
}

export function splitMarkdownSections(markdown: string): MarkdownSection[] {
  const lines = String(markdown || '').split('\n');
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection = { heading: '', lines: [] };
  for (const line of lines) {
    const trimmed = line.trim();
    if (isSubHeadingLine(trimmed) && current.lines.some((l) => l.trim().length > 0)) {
      sections.push(current);
      current = { heading: trimmed, lines: [line] };
      continue;
    }
    if (isSubHeadingLine(trimmed) && !current.heading) current.heading = trimmed;
    current.lines.push(line);
  }
  sections.push(current);
  return sections;
}

export function cleanHeadingLabel(heading: string, fallback: string = 'Sección técnica'): string {
  const clean = String(heading || '')
    .replace(/^#+\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/:$/, '')
    .replace(/^\[[^\]]*\]\s*/, '')
    .trim();
  return clean || fallback;
}

export function sanitizeMarkdownLabel(s: string, max: number = 220, keepParens: boolean = false): string {
  return String(s || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/`/g, '')
    .replace(keepParens ? /[[\]]/g : /[[\]()]/g, ' ')
    .replace(/"/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function buildSourceWhitelist(sources: ItemizedSource[] = []): ItemizedSource[] {
  const seen = new Set<string>();
  const out: ItemizedSource[] = [];
  for (const s of sources || []) {
    const url = String(s?.url || '').trim();
    if (!/^https:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ ...s, url });
  }
  return out;
}

function sameUrl(a: string, b: string): boolean {
  const norm = (u: string) => String(u || '').trim().replace(/\/+$/, '').replace(/#.*$/, '');
  return norm(a) === norm(b);
}

export function sourceLabel(src: ItemizedSource): string {
  return sanitizeMarkdownLabel(`${src.author || 'Fuente técnica'}${src.description ? ` — ${src.description}` : ''}`, 140);
}

export function pickBestSource(context: string, whitelist: ItemizedSource[]): ItemizedSource | null {
  if (!whitelist.length) return null;
  let best = whitelist[0];
  let bestScore = -1;
  for (const src of whitelist) {
    const overlap = tokenContainment(`${src.author || ''} ${src.description || ''}`, context);
    const oemBonus = src.type === 'OEM' ? 0.12 : 0;
    const pdfBonus = /\.pdf(?:$|\?)/i.test(src.url) ? 0.08 : 0;
    const redirectPenalty = /vertexaisearch\.cloud\.google\.com/i.test(src.url) ? -0.05 : 0;
    const score = overlap + oemBonus + pdfBonus + redirectPenalty;
    if (score > bestScore) {
      bestScore = score;
      best = src;
    }
  }
  return best;
}

export function resolveWhitelistedSource(
  candidateUrl: string,
  whitelist: ItemizedSource[],
  context: string
): ItemizedSource | null {
  const exact = whitelist.find((s) => candidateUrl && sameUrl(s.url, candidateUrl));
  return exact || pickBestSource(context, whitelist);
}

const RESOURCE_TYPE_PATTERNS: Array<[RegExp, string]> = [
  [/recorrido\s+(?:perimetral|360|pre-?operacional)|vuelta\s+del\s+perro|walk-?around/i, 'Mapa de recorrido de inspección pre-operacional 360° (Vuelta del Perro)'],
  [/chequeo\s+diario|puntos\s+de\s+inspecci[oó]n\s+diaria|mirilla(?:s)?\s+de\s+nivel|varilla\s+de\s+nivel/i, 'Diagrama de puntos de chequeo diario de niveles, mirillas y drenajes'],
  [/instrumentaci[oó]n|tablero|monitor|testigos|indicadores\s+luminosos|panel\s+de\s+instrumentos/i, 'Mapa del panel de instrumentos y testigos de advertencia'],
  [/joystick|patr[oó]n\s+de\s+control|iso\s*\/\s*sae/i, 'Diagrama de patrón de control de joysticks'],
  [/mandos|consola|cabina|puesto\s+de\s+mando|pedales|palancas/i, 'Diagrama de disposición de mandos y consola de cabina'],
  [/calcoman[ií]a|etiqueta(?:s)?\s+de\s+(?:advertencia|seguridad|peligro)|se[nñ]al[eé]tica\s+de\s+seguridad|warning\s+decal/i, 'Mapa de ubicación de calcomanías y etiquetas de advertencia ISO 7010 en el equipo'],
  [/punto(?:s)?\s+ciego(?:s)?|radio\s+de\s+(?:giro|seguridad)|zona(?:s)?\s+de\s+(?:atrapamiento|pellizco|aplastamiento)|visibilidad\s+perimetral/i, 'Diagrama de zonas de atrapamiento, puntos ciegos y radio de giro seguro'],
  [/extintor|afex|supresi[oó]n\s+de\s+incendio|salida(?:s)?\s+de\s+emergencia|v[ií]a(?:s)?\s+de\s+evacuaci[oó]n/i, 'Diagrama de ubicación de extintor, sistema AFEX y salidas de emergencia'],
  [/aislamiento\s+loto|energ[ií]a\s+cero|purga\s+de\s+presi[oó]n|despresurizaci[oó]n/i, 'Diagrama de puntos de aislamiento LOTO y purga de presión residual'],
  [/remolque|liberaci[oó]n\s+de\s+freno|traba\s+mec[aá]nica|corte\s+maestro|loto/i, 'Diagrama de puntos de bloqueo mecánico y liberación para remolque'],
  [/acople\s+r[aá]pido|quick\s+coupler|implemento/i, 'Diagrama de acoplamiento de implemento'],
  [/muestreo|s[·.]?o[·.]?s|mirilla|visor\s+de\s+nivel|toma\s+de\s+muestra/i, 'Diagrama de ubicación de puertos de muestreo S·O·S y mirillas de nivel'],
  [/lubricaci[oó]n|engrase|grasera|zerk|filtro|drenaje|respiradero/i, 'Mapa de puntos de engrase, filtros y drenajes de servicio'],
  [/torque|apriete|perno|par\s+de\s+apriete|holgura|luz\s+de\s+v[aá]lvula|tensi[oó]n\s+de\s+correa|tensi[oó]n\s+de\s+cadena/i, 'Diagrama de secuencia de apriete, pares de torque y puntos de ajuste'],
  [/esquema\s+hidr[aá]ulico|hidr[aá]ulic/i, 'Esquema hidráulico'],
  [/esquema\s+el[eé]ctrico|el[eé]ctric|arn[eé]s|conector|inyecci[oó]n|common\s+rail|ecm/i, 'Diagrama de componentes electrónicos e inyección'],
  [/plano\s+dimensional|dimensiones|acotad/i, 'Plano dimensional'],
  [/curva|gr[aá]fic/i, 'Curva técnica'],
  [/fotograf[ií]a|foto\b|vista\s+real/i, 'Fotografía de componente'],
];

export function inferResourceType(text: string): string {
  for (const [re, label] of RESOURCE_TYPE_PATTERNS) if (re.test(text)) return label;
  return 'Diagrama técnico';
}

export type PendingFigureType = ExtractedFigureRef['figure_type'];

export const PENDING_FIGURE_TYPES: PendingFigureType[] = [
  'ESQUEMA_HIDRAULICO_ELECTRICO',
  'DIAGRAMA_ACOTADO',
  'FOTO_COMPONENTE',
  'CURVA_RENDIMIENTO',
  'MAPA_LUBRICACION_PM',
  'SIMBOLOGIA_SEGURIDAD',
  'PLANO_VECTORIAL_SVG',
];

export function inferFigureTypeFromDescription(text: string): PendingFigureType {
  if (/calcoman[ií]a|etiqueta(?:s)?\s+de\s+(?:advertencia|seguridad)|se[nñ]al[eé]tica|extintor|afex|salida(?:s)?\s+de\s+emergencia|evacuaci[oó]n/i.test(text)) {
    return 'SIMBOLOGIA_SEGURIDAD';
  }
  if (/lubricaci[oó]n|engrase|grasera|zerk|filtro|drenaje|respiradero|muestreo|s[·.]?o[·.]?s|mirilla/i.test(text)) {
    return 'MAPA_LUBRICACION_PM';
  }
  if (/hidr[aá]ulic|el[eé]ctric|conexi[oó]n|p[oó]rtico|conector|arn[eé]s|inyecci[oó]n|common\s+rail|ecm|instrumentaci[oó]n|tablero|monitor|testigos/i.test(text)) {
    return 'ESQUEMA_HIDRAULICO_ELECTRICO';
  }
  if (/curva|gr[aá]fic|rendimiento/i.test(text)) return 'CURVA_RENDIMIENTO';
  if (/fotograf[ií]a|foto\b/i.test(text)) return 'FOTO_COMPONENTE';
  if (/seguridad|advertencia|peligro/i.test(text)) return 'SIMBOLOGIA_SEGURIDAD';
  return 'DIAGRAMA_ACOTADO';
}

export function buildDeterministicPendingDescription(
  headingLabel: string,
  literalCallouts: string[],
  typeHintText: string = ''
): string {
  const cleanHint = sanitizeMarkdownLabel(typeHintText, 240, true);
  if (cleanHint.length >= 18 && !/^diagrama\s+t[eé]cnico\s+de\s+referencia/i.test(cleanHint)) {
    const tail =
      literalCallouts.length > 0 && !cleanHint.toLowerCase().includes('elementos referenciados')
        ? ` — Elementos referenciados en el texto: ${literalCallouts.join(', ')}`
        : '';
    return sanitizeMarkdownLabel(`${cleanHint}${tail}`, 320, true);
  }
  const type = inferResourceType(`${typeHintText} ${headingLabel} ${literalCallouts.join(' ')}`);
  const base = `${type} de referencia para "${sanitizeMarkdownLabel(headingLabel, 120, true)}"`;
  const tail = literalCallouts.length > 0 ? ` — Elementos referenciados en el texto: ${literalCallouts.join(', ')}` : '';
  return sanitizeMarkdownLabel(`${base}${tail}`, 320, true);
}

export function buildPendingMarkerLine(description: string, source: ItemizedSource | null): string {
  const desc = sanitizeMarkdownLabel(description, 320, true);
  if (!source) return `![IMAGEN_PENDIENTE: ${desc}](${NO_SOURCE_URL} "Fuente no declarada")`;
  return `![IMAGEN_PENDIENTE: ${desc}](${source.url} "${sourceLabel(source)}")`;
}

export function parsePendingMarker(line: string): { description: string; url: string; title: string } | null {
  const trimmed = String(line || '')
    .trim()
    .replace(/^[-*>•]+\s*/, '')
    .trim();
  const headerMatch = trimmed.match(/^!?\[IMAGEN[_\s-]PENDIENTE:\s*(.+)$/i);
  if (!headerMatch) return null;

  const rest = headerMatch[1].trim();
  const closeBracketParen = rest.lastIndexOf('](');
  if (closeBracketParen !== -1) {
    const rawDesc = rest.slice(0, closeBracketParen).trim();
    const rawTarget = rest
      .slice(closeBracketParen + 2)
      .replace(/\)\s*$/, '')
      .trim();
    const urlTitle = rawTarget.match(/^([^\s"]*)(?:\s+"([^"]*)")?$/);
    const cleanDesc = sanitizeMarkdownLabel(rawDesc, 320, true);
    if (!cleanDesc) return null;
    return {
      description: cleanDesc,
      url: urlTitle && urlTitle[1] ? urlTitle[1].trim() : NO_SOURCE_URL,
      title: urlTitle && urlTitle[2] ? urlTitle[2].trim() : '',
    };
  }

  const rawDescOnly = rest
    .replace(/\]\s*\([^)]*$/, '')
    .replace(/\]\s*$/, '')
    .trim();
  const cleanDescOnly = sanitizeMarkdownLabel(rawDescOnly, 320, true);
  if (!cleanDescOnly) return null;
  return {
    description: cleanDescOnly,
    url: NO_SOURCE_URL,
    title: '',
  };
}

export function normalizeBrokenPendingMarkersInMarkdown(
  markdown: string,
  itemTitle: string = '',
  sources: ItemizedSource[] = []
): string {
  if (!markdown || !/IMAGEN[_\s-]PENDIENTE:/i.test(markdown)) return markdown;
  const whitelist = buildSourceWhitelist(sources);

  const separated = String(markdown).replace(
    /([^\n\r])\s+(!?\[IMAGEN[_\s-]PENDIENTE:\s*)/gi,
    (full, prevChar: string, markerStart: string) => {
      if (/^[-*>•]$/.test(prevChar)) return full;
      return `${prevChar}\n\n${markerStart.startsWith('!') ? markerStart : `!${markerStart}`}`;
    }
  );

  const sections = splitMarkdownSections(separated);
  const outSections: string[] = [];
  for (const sec of sections) {
    const secPlain = sec.lines.join('\n').replace(PENDING_MARKER_GLOBAL_REGEX, ' ');
    const headingLabel = cleanHeadingLabel(sec.heading, itemTitle || 'Sección técnica');
    const callouts = extractDiagramCallouts(secPlain);
    const normalizedLines = sec.lines.map((line) => {
      const parsed = parsePendingMarker(line);
      if (!parsed) return line;
      const resolvedSource = resolveWhitelistedSource(
        parsed.url && parsed.url !== NO_SOURCE_URL ? parsed.url : '',
        whitelist,
        `${headingLabel} ${parsed.description} ${callouts.join(' ')} ${parsed.title}`
      );
      return buildPendingMarkerLine(parsed.description, resolvedSource);
    });
    outSections.push(normalizedLines.join('\n'));
  }

  return outSections.join('\n');
}

export function injectExplicitFigureCitationInSection(
  sectionLines: string[],
  figureNumber: number,
  figureTitle: string
): string[] {
  const cleanTitle = sanitizeMarkdownLabel(figureTitle || 'Figura técnica', 120, true);
  const citationTag = `(ver Figura ${figureNumber}: ${cleanTitle})`;
  const joined = sectionLines.join('\n');
  if (new RegExp(`\\bFigura\\s+${figureNumber}\\b`, 'i').test(joined)) {
    return sectionLines;
  }

  const out = [...sectionLines];
  let targetIdx = -1;
  for (let i = 0; i < out.length; i++) {
    const t = out[i].trim();
    if (!t || isSubHeadingLine(t) || t.startsWith('|') || t.startsWith('![')) continue;
    if (EXPLICIT_VISUAL_PHRASE.test(t)) {
      targetIdx = i;
      break;
    }
  }
  if (targetIdx === -1) {
    for (let i = out.length - 1; i >= 0; i--) {
      const t = out[i].trim();
      if (!t || isSubHeadingLine(t) || t.startsWith('|') || t.startsWith('![') || t.startsWith('*Figura')) continue;
      targetIdx = i;
      break;
    }
  }

  if (targetIdx !== -1) {
    const line = out[targetIdx].trimEnd();
    if (/[.:;]$/.test(line)) {
      out[targetIdx] = `${line.slice(0, -1)} ${citationTag}${line.slice(-1)}`;
    } else {
      out[targetIdx] = `${line} ${citationTag}.`;
    }
  }
  return out;
}

export function sanitizeMarkdownFiguresAndBrokenMarkers(
  markdown: string,
  itemTitle: string = '',
  itemSources: ItemizedSource[] = [],
  galleryFigures: ExtractedFigureRef[] = []
): string {
  if (!markdown) return '';
  const normalizedMarkers = normalizeBrokenPendingMarkersInMarkdown(markdown, itemTitle, itemSources);
  const manualUrls = new Set(
    (galleryFigures || [])
      .filter((f) => String(f?.figure_id || '').startsWith('fig_manual_'))
      .map((f) => f.storage_url)
  );

  const sections = splitMarkdownSections(normalizedMarkers);
  const cleanedSections: string[] = [];
  let keptFigureCounter = 0;

  for (const sec of sections) {
    const proseLines = sec.lines.filter((l) => {
      const t = l.trim();
      if (!t) return false;
      if (parsePendingMarker(t)) return false;
      if (/^!\[[^\]]*\]\([^)]+\)$/.test(t)) return false;
      if (/^\*Figura\s+(?:t[eé]cnica|\d+):/i.test(t)) return false;
      if (/^\s*-\s+\*\*\[\d+\]\*\*/.test(t)) return false;
      return true;
    });
    const sectionProse = proseLines.join('\n');
    const sectionTokenSet = technicalTokens(sectionProse);
    const sectionNorm = normalizeTechText(sectionProse);

    let keptLines: string[] = [];
    let i = 0;
    while (i < sec.lines.length) {
      const raw = sec.lines[i];
      const trimmed = raw.trim();

      if (parsePendingMarker(trimmed)) {
        keptLines.push(raw);
        i++;
        continue;
      }

      if (/^\*Figura\s+(?:t[eé]cnica|\d+):/i.test(trimmed)) {
        const prevNonEmpty = [...keptLines].reverse().find((kl) => kl.trim().length > 0)?.trim() || '';
        if (!/^!\[(?!IMAGEN[_\s-]PENDIENTE)[^\]]*\]\([^)]+\)$/i.test(prevNonEmpty)) {
          i++;
          while (i < sec.lines.length && /^\s*-\s+\*\*\[[^\]]+\]\*\*/.test(sec.lines[i])) {
            i++;
          }
          continue;
        }
      }

      const imgMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (imgMatch) {
        const altText = imgMatch[1].trim();
        const imgUrl = imgMatch[2].trim();
        let nextNonEmptyIdx = i + 1;
        while (nextNonEmptyIdx < sec.lines.length && !sec.lines[nextNonEmptyIdx].trim()) {
          nextNonEmptyIdx++;
        }
        const nextLine = nextNonEmptyIdx < sec.lines.length ? sec.lines[nextNonEmptyIdx].trim() : '';
        const hasCaptionLine = /^\*Figura\s+(?:t[eé]cnica|\d+):/i.test(nextLine);
        const combinedLabel = `${altText} ${hasCaptionLine ? nextLine : ''}`;

        const isBannedChartOrSynthetic =
          /Comparativa\s+de\s+magnitudes|Comparativa\s+Param[eé]trica\s+SI|Plano\s+Dimensional\s+Acotado|Plano\s+Dimensional\s+y\s+Par[aá]metros|Mapa\s+de\s+Inspecci[oó]n\s+360|Matriz\s+Cronol[oó]gica\s+PM/i.test(
            combinedLabel
          ) || SPARE_PART_PACKSHOT_REGEX.test(combinedLabel);

        const cleanFigureTitle = altText.replace(/^Figura\s+(?:t[eé]cnica|\d+):\s*/i, '').trim();
        const isManualFigure = manualUrls.has(imgUrl);
        const subjectTokens = subjectTokensFromFigureTitle(cleanFigureTitle);
        let matchedSubjects = 0;
        for (const tok of subjectTokens) {
          if (sectionTokenSet.has(tok) || sectionNorm.includes(tok)) matchedSubjects++;
        }
        const isExplicitlyCitedInProse =
          isManualFigure ||
          (hasExplicitVisualReference(sectionProse) &&
            subjectTokens.length > 0 &&
            matchedSubjects / subjectTokens.length >= 0.5);

        if (isBannedChartOrSynthetic || !isExplicitlyCitedInProse) {
          i = hasCaptionLine ? nextNonEmptyIdx + 1 : i + 1;
          while (i < sec.lines.length && (!sec.lines[i].trim() || /^\s*-\s+\*\*\[[^\]]+\]\*\*/.test(sec.lines[i]))) {
            if (!sec.lines[i].trim()) {
              const peek = i + 1 < sec.lines.length ? sec.lines[i + 1] : '';
              if (!/^\s*-\s+\*\*\[[^\]]+\]\*\*/.test(peek)) break;
            }
            i++;
          }
          continue;
        }

        keptFigureCounter += 1;
        const displayTitle = cleanFigureTitle || `Figura ${keptFigureCounter}`;
        keptLines = injectExplicitFigureCitationInSection(keptLines, keptFigureCounter, displayTitle);
        keptLines.push(`![Figura ${keptFigureCounter}: ${displayTitle}](${imgUrl})`);
        if (hasCaptionLine) {
          const normalizedCaption = nextLine.replace(
            /^\*Figura\s+(?:t[eé]cnica|\d+):/i,
            `*Figura ${keptFigureCounter}:`
          );
          keptLines.push(normalizedCaption);
          i = nextNonEmptyIdx + 1;
        } else {
          i++;
        }
        continue;
      }

      keptLines.push(raw);
      i++;
    }

    cleanedSections.push(keptLines.join('\n'));
  }

  return cleanedSections.join('\n').replace(/\n{4,}/g, '\n\n\n');
}

export function figureMatchText(fig: ExtractedFigureRef): string {
  const callouts = Array.isArray(fig.callouts)
    ? fig.callouts.map((c) => `${c.callout} ${c.component_es} ${c.function_or_spec || ''}`).join(' ')
    : '';
  return `${fig.title_es || ''} ${fig.caption_es || ''} ${callouts}`;
}

export const FIGURE_SECTION_MATCH_THRESHOLD = 0.45;

function sectionHasRealImage(sectionText: string): boolean {
  return /!\[(?!IMAGEN[_\s-]PENDIENTE)[^\]]*\]\([^)]+\)/i.test(sectionText);
}

/**
 * Normaliza marcadores rotos, filtra imágenes no citadas y garantiza por sección que toda referencia visual
 * explícita sin imagen real muestre su tarjeta `PendingSectionFigureCard`.
 */
export function injectLegacyPendingMarkers(
  content: string,
  itemTitle: string,
  itemSources: ItemizedSource[] = [],
  galleryFigures: ExtractedFigureRef[] = []
): string {
  if (!content) return '';
  const sanitized = sanitizeMarkdownFiguresAndBrokenMarkers(content, itemTitle, itemSources, galleryFigures);
  const whitelist = buildSourceWhitelist(itemSources);
  const out: string[] = [];
  for (const sec of splitMarkdownSections(sanitized)) {
    const text = sec.lines.join('\n');
    const hasPendingInSection = sec.lines.some((l) => parsePendingMarker(l) !== null);
    out.push(...sec.lines);
    if (hasPendingInSection || sectionHasRealImage(text) || !hasExplicitVisualReference(text)) continue;
    const headingLabel = cleanHeadingLabel(sec.heading, itemTitle || 'Sección técnica');
    const callouts = extractDiagramCallouts(text);
    const description = buildDeterministicPendingDescription(headingLabel, callouts);
    const source = pickBestSource(`${headingLabel} ${callouts.join(' ')}`, whitelist);
    out.push('', buildPendingMarkerLine(description, source), '');
  }
  return out.join('\n');
}

export function countPendingMarkers(markdown: string): number {
  if (!markdown) return 0;
  return String(markdown)
    .split('\n')
    .filter((line) => parsePendingMarker(line) !== null).length;
}

/** Total de imágenes pendientes de un ítem (persistidas + detectadas por sección). */
export function countItemPendingFigures(
  content: string | null | undefined,
  itemTitle: string,
  itemSources?: ItemizedSource[],
  galleryFigures?: ExtractedFigureRef[]
): number {
  if (!content) return 0;
  return countPendingMarkers(injectLegacyPendingMarkers(content, itemTitle, itemSources || [], galleryFigures || []));
}
