/**
 * Política "Strict Explicit Mention Only" para simbología inline (`SB-03` / `SB-04`).
 * Espejo cliente de `src/modules/opermaq/services/NeuroSymbolicVerifier.ts` para sanear
 * contenido ya persistido antes de la remediación: un marcador `[SÍMBOLO: id]` solo se
 * conserva si su línea contiene el código normativo literal o un contexto explícito
 * (testigo/indicador/alarma, uso de EPP o peligro señalizado). En `ficha_tecnica`
 * solo se aceptan códigos normativos literales.
 */

export const SYNTHETIC_ADHOC_SYMBOL_AUTHOR = 'AGENTE_CAZADOR_IA_V5';

type InlineSymbolCategory = 'TELLTALE' | 'PPE' | 'HAZARD';

const SYMBOL_MARKER_REGEX = /\s*\[[sS][íÍiI][mM][bB][oO][lL][oO]:\s*([a-zA-Z0-9_-]+)\]/g;

const EXPLICIT_CONTEXT_BY_CATEGORY: Record<InlineSymbolCategory, RegExp> = {
  TELLTALE:
    /\b(?:testigo(?:s)?|indicador(?:es)?\s+(?:luminoso|de\s+advertencia|de\s+alarma|del\s+tablero|en\s+tablero|en\s+monitor)|luz(?:\s+|\s+de\s+)(?:advertencia|aviso|alarma|alerta)|luz\s+piloto|piloto\s+luminoso|se\s+enciende|se\s+ilumina|parpadea|destell(?:a|o)|alarma\s+(?:visual|ac[uú]stica|sonora|continua|intermitente)|categor[ií]a\s+(?:de\s+(?:advertencia|alerta)\s*)?[123](?:-S)?|nivel\s+de\s+(?:alerta|advertencia)\s*[123]|[ií]cono\s+(?:en\s+)?(?:pantalla|monitor|tablero)|pictograma|s[ií]mbolo\s+(?:ISO|del\s+tablero|de\s+advertencia|(?:en\s+|grabado\s+en\s+)?(?:interruptor|selector|tecla|bot[oó]n|consola|tablero))|mirilla|visor\s+de\s+nivel|varilla\s+de\s+(?:nivel|medici[oó]n)|prueba\s+funcional|verificaci[oó]n\s+funcional|comprobar\s+funcionamiento|autochequeo)\b/i,
  PPE: /\b(?:EPP|uso\s+obligatorio|obligatorio|obligatoria|usar|utilizar|use|utilice|portar|requiere(?:n)?|requerid[oa]s?|equipar|protecci[oó]n\s+(?:ocular|auditiva|facial|respiratoria|de\s+manos|de\s+pies)|equipo\s+de\s+protecci[oó]n\s+personal|elemento(?:s)?\s+de\s+protecci[oó]n)\b/i,
  HAZARD:
    /\b(?:peligro|riesgo|advertencia|precauci[oó]n|atenci[oó]n|prohibido|se[nñ]al(?:[eé]tica)?|rotulad[oa]|etiqueta(?:do)?\s+de\s+peligro|pictograma|emergencia|evacuaci[oó]n|extintor|incendio|bloqueo\s+LOTO|energ[ií]a\s+cero|fluido\s+(?:presurizado|caliente|a\s+alta\s+presi[oó]n)|inyecci[oó]n\s+(?:de\s+fluido|cut[aá]nea)|superficie\s+caliente|quemadura(?:s)?|aplastamiento|atrapamiento|arco\s+el[eé]ctrico|despresurizar|fatalidad|amputaci[oó]n|electrocuci[oó]n|intoxicaci[oó]n|hipoacusia|silicosis|vuelco|colisi[oó]n|atropello|ca[ií]da\s+a\s+distinto\s+nivel|proyecci[oó]n\s+de\s+part[ií]culas|derrame|explosi[oó]n|traba\s+mec[aá]nica|desenergizar|purga)\b/i,
};

function categorizeConcept(conceptId: string): InlineSymbolCategory {
  if (/^iso_7010_m\d{3}/.test(conceptId)) return 'PPE';
  if (/^(iso_7010_[wfe]\d{3}|iec_60417_|ghs_)/.test(conceptId)) return 'HAZARD';
  return 'TELLTALE';
}

function lineHasLiteralCodeFor(conceptId: string, lineText: string, isoReference?: string): boolean {
  const upperLine = lineText.toUpperCase();
  const compactLine = upperLine.replace(/[\s_-]+/g, '');
  const compactRef = String(isoReference || '').toUpperCase().replace(/[\s_-]+/g, '');
  if (compactRef && compactRef.length >= 6 && compactLine.includes(compactRef)) return true;
  const m7010 = conceptId.match(/^iso_7010_([mwpfe]\d{3})/);
  if (m7010 && new RegExp(`\\b${m7010[1].toUpperCase()}\\b`).test(upperLine)) return true;
  const mGhs = conceptId.match(/^ghs_0(\d)_/);
  if (mGhs && new RegExp(`\\bGHS\\s*0?${mGhs[1]}\\b`, 'i').test(lineText)) return true;
  const mIso = conceptId.match(/^(iso_7000|iso_2575|iec_60417)_([a-z0-9]{3,4})_/);
  if (mIso) {
    const family = mIso[1] === 'iso_7000' ? 'ISO7000' : mIso[1] === 'iso_2575' ? 'ISO2575' : 'IEC60417';
    if (compactLine.includes(`${family}${mIso[2].toUpperCase()}`)) return true;
  }
  return false;
}

function getLineAt(text: string, index: number): string {
  const start = Math.max(0, text.lastIndexOf('\n', index - 1) + 1);
  const endNl = text.indexOf('\n', index);
  return text.slice(start, endNl === -1 ? text.length : endNl);
}

/**
 * Elimina limpiamente los marcadores `[SÍMBOLO: ...]` especulativos o fuera de contexto del contenido
 * ya cazado (sin dejar badges huérfanos).
 */
export function sanitizeSpeculativeSymbolMarkers(
  content: string,
  pillarId?: string,
  isoReferenceById?: Record<string, string | undefined>
): string {
  if (!content) return content;
  return content.replace(SYMBOL_MARKER_REGEX, (fullMatch, rawId: string, offset: number, source: string) => {
    const conceptId = String(rawId || '').trim().toLowerCase();
    if (!conceptId) return '';
    const lineText = getLineAt(source, offset);
    if (lineHasLiteralCodeFor(conceptId, lineText, isoReferenceById?.[conceptId])) return fullMatch;
    if (pillarId === 'ficha_tecnica') return '';
    const lineWithoutMarkers = lineText.replace(SYMBOL_MARKER_REGEX, ' ');
    return EXPLICIT_CONTEXT_BY_CATEGORY[categorizeConcept(conceptId)].test(lineWithoutMarkers) ? fullMatch : '';
  });
}

/** Extrae los `concept_id` de los marcadores que sobreviven a la política de mención explícita. */
export function extractExplicitSymbolIds(
  content: string,
  pillarId?: string,
  isoReferenceById?: Record<string, string | undefined>
): string[] {
  const sanitized = sanitizeSpeculativeSymbolMarkers(content, pillarId, isoReferenceById);
  const ids = new Set<string>();
  const re = new RegExp(SYMBOL_MARKER_REGEX.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(sanitized)) !== null) {
    const cid = m[1].trim();
    if (cid) ids.add(cid);
  }
  return Array.from(ids);
}

/** Símbolo de `master_symbology_vault` apto para render: no sintético y con ícono verificado. */
export function isTrustedMasterSymbol(sym?: { created_by?: string; standard_icon_status?: string } | null): boolean {
  if (!sym) return false;
  if (sym.created_by === SYNTHETIC_ADHOC_SYMBOL_AUTHOR) return false;
  if (sym.standard_icon_status && sym.standard_icon_status !== 'encontrado') return false;
  return true;
}

