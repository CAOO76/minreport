import type { ItemizedSource } from '../types/vault.types';

/**
 * TECHNICAL EVIDENCE VERIFIER v1 — Trazabilidad por fila para tablas de Ficha Técnica (0 tokens IA)
 *
 * Re-Auditoría v2 · F3:
 * - OPT-F3.1: Atribución de fila a fuente mediante `groundingSupports` de Gemini (segmento → `groundingChunks`).
 * - OPT-F3.2: Verificación numérica determinista: cada valor `número + unidad` de la columna de valor debe encontrarse
 *   (tolerancia 0,5 % y formatos `28.000` / `28,000` / `28 000`) en el texto de evidencia real descargado
 *   (corpus local, documentos de bóveda, HTML/PDF de fuentes web).
 *   Las filas sin evidencia numérica ni atribución se marcan `[Sin trazabilidad directa]` y se excluyen del gráfico.
 */

export const UNTRACED_ROW_TAG = '[Sin trazabilidad directa]';

export interface EvidenceDocument {
    url: string;
    text: string;
}

interface IndexedEvidence {
    url: string;
    values: Float64Array;
}

export interface RowTraceInfo {
    refUrls: string[];
    evidenceVerified: boolean;
    untraced: boolean;
    targetCellIndex: number;
}

export interface TableTraceAnalysis {
    rows: Map<string, RowTraceInfo>;
    stats: {
        rows_checked: number;
        evidence_verified: number;
        grounded_only: number;
        untraced: number;
    };
}

const NUMBER_TOKEN = /\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g;

/** Devuelve las interpretaciones numéricas posibles de un token (formato anglo y formato hispano). */
export function interpretNumberToken(raw: string): number[] {
    const token = raw.trim();
    const out = new Set<number>();
    const spaced = token.replace(/\s/g, '');
    // Formato anglo: coma miles, punto decimal
    const en = Number(spaced.replace(/,/g, ''));
    if (Number.isFinite(en)) out.add(en);
    // Formato hispano: punto miles, coma decimal
    const es = Number(spaced.replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(es)) out.add(es);
    return Array.from(out);
}

function extractNumbers(text: string): number[] {
    const values: number[] = [];
    const matches = String(text || '').match(NUMBER_TOKEN) || [];
    for (const m of matches) {
        for (const v of interpretNumberToken(m)) values.push(v);
    }
    return values;
}

export function buildEvidenceIndex(docs: EvidenceDocument[]): IndexedEvidence[] {
    const out: IndexedEvidence[] = [];
    for (const d of docs || []) {
        if (!d?.text || d.text.length < 20) continue;
        const nums = Array.from(new Set(extractNumbers(d.text))).sort((a, b) => a - b);
        if (nums.length === 0) continue;
        out.push({ url: d.url, values: Float64Array.from(nums) });
    }
    return out;
}

function hasValueWithinTolerance(sorted: Float64Array, target: number, relTol: number = 0.005): boolean {
    const tol = Math.max(Math.abs(target) * relTol, 1e-9);
    let lo = 0;
    let hi = sorted.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const v = sorted[mid];
        if (Math.abs(v - target) <= tol) return true;
        if (v < target) lo = mid + 1;
        else hi = mid - 1;
    }
    return false;
}

/** Unidades físicas SI e imperiales que distinguen una magnitud medible de un código, pin o categoría. */
const PHYSICAL_MEASUREMENT_REGEX =
    /\b\d+(?:[.,\s]\d+)*\s*(?:kpa|mpa|bar|psi|°c|°f|rpm|r\/min|km\/h|mph|l\/min|gpm|cm³|in³|m³|yd³|ft³|ml|gal|qt|quarts?|l\b|kg|lb|t\b|kw|hp|cv|n·m|nm|lb-ft|lb·ft|in-lb|in·lb|lb-in|lb·in|lbf-in|lbf·in|kn|dan|vdc|vac|v\b|ah|cca|a\b|hz|mm|cm|m\b|in\b|ft\b|seg|min\b|hr|hrs|h\b|s\b|%|°|db\(a\)|db\(c\)|dba\b|db\b|km\b|ppm|cst|mm²\/s|mm2\/s|m\/s²|m\/s2|mg\/m³|mg\/m3|cal\/cm²|cal\/cm2|lux\b|lx\b|µm|micras?|kohm|mohm)/i;

const NON_MEASUREMENT_CODE_TOKEN_REGEX =
    /\b(?:(?:ISO|SAE|IEC|DIN|EN|ASTM|API|ACEA|NLGI|EPA|EU|Tier|Stage|DS|D\.S\.|Decreto|Ley|Art\.?|Art[ií]culo|NCh|OSHA|MSHA|NFPA|ANSI|NIOSH|ACGIH|GHS|UN|CFR|PREXOR|PLANESI|TMERT|MMC|Categor[ií]a|Nivel|Pin|Pines|Callout|Posici[oó]n|Paso|Etapa|Fase|Dominio|Zona|Mando|C[oó]digo|Serie|Prefijo|Clase|Grupo|Tipo|Filtro)\s*(?:N[°º]?\s*)?[-:#]?\s*[A-Za-z0-9./-]+|\d{1,2}W-\d{2}|\d{2}\/\d{2}\/\d{2}|PM[1-9]|M\d{1,2}(?:x[\d.,]+)?|IP\d{2}[A-Z]?|P100|GHS0[1-9]|[LREG][1-5]|[24][HL]|(?:DEO|TDTO|HYDO|FDAO|ELC|TO-\d|GL-\d|CK-4|CJ-4|CI-4|DOT\s*\d))\b|(?:360|180|90)\s*°|100\s*%/gi;

/** Números discriminantes de una celda (excluyendo códigos normativos/categorías): ≥ 10 o con decimales. */
function discriminatingNumbers(cell: string): number[][] {
    const cleaned = String(cell || '').replace(NON_MEASUREMENT_CODE_TOKEN_REGEX, ' ');
    const groups: number[][] = [];
    const matches = cleaned.match(NUMBER_TOKEN) || [];
    for (const m of matches) {
        const interps = interpretNumberToken(m);
        const discriminating = interps.some((v) => Math.abs(v) >= 10 || !Number.isInteger(v));
        if (discriminating) groups.push(interps);
    }
    return groups;
}

/**
 * Localiza en una fila de tabla Markdown (3 a 6 columnas) la celda que contiene una magnitud física medible (`número + unidad`),
 * priorizando el orden exacto de columnas del esquema tabular de cada pilar:
 * - `ficha_tecnica` (3 cols): `[1, 2]` (`Valor OEM (SI + Imperial)`)
 * - `manual_operaciones` (4 cols): `[2, 1, 3]` (`Función / Umbral (SI + Imperial)`)
 * - `pauta_mantencion` (4–5 cols): `[3, 4, 2, 1]` (`Capacidad / Fluido` y `Criterio / Torque`)
 * - `matriz_riesgos` (5 cols): `[2, 3, 1]` (`Magnitud / Umbral Crítico SI` y `Controles Duros y LOTO`)
 * - `checklist_pre_op` (6 cols): `[2, 1]` (`Criterio Técnico de Aceptación (Umbral SI / Imperial)`)
 */
export function findPhysicalMeasurementCellIndex(cells: string[], pillarId?: string): number {
    if (cells.length < 2) return -1;
    const candidateIndices =
        pillarId === 'ficha_tecnica'
            ? [1, 2]
            : pillarId === 'manual_operaciones'
            ? [2, 1, 3]
            : pillarId === 'pauta_mantencion'
            ? [3, 4, 2, 1]
            : pillarId === 'matriz_riesgos'
            ? [2, 3, 1]
            : pillarId === 'checklist_pre_op'
            ? [2, 1]
            : [1, 2, 3, 4];
    for (const idx of candidateIndices) {
        if (idx >= cells.length) continue;
        const c = cells[idx];
        if (!c || /no declarada|pendiente de registro|sin trazabilidad/i.test(c)) continue;
        if (PHYSICAL_MEASUREMENT_REGEX.test(c) && discriminatingNumbers(c).length > 0) {
            return idx;
        }
    }
    // En Ficha Técnica, si `cells[1]` tiene cifras discriminantes limpias (ej. relación de compresión 17,5:1), verificar `cells[1]`
    if (pillarId === 'ficha_tecnica' && !/no declarada|pendiente de registro|sin trazabilidad/i.test(cells[1])) {
        if (discriminatingNumbers(cells[1]).length > 0) return 1;
    }
    return -1;
}

export function normalizeParamKey(cell: string): string {
    return String(cell || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[*`_]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function splitRowCells(line: string): string[] {
    return line
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => c.trim());
}

function isSeparatorRow(cells: string[]): boolean {
    return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '');
}

/** Itera las filas de cuerpo de todas las tablas Markdown (excluye encabezado y separador). */
export function forEachTableBodyRow(markdown: string, cb: (line: string, cells: string[]) => void): void {
    const lines = String(markdown || '').split('\n');
    let i = 0;
    while (i < lines.length) {
        if (!lines[i].trim().startsWith('|')) {
            i++;
            continue;
        }
        const block: string[] = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) {
            block.push(lines[i]);
            i++;
        }
        let headerSkipped = false;
        for (const row of block) {
            const cells = splitRowCells(row);
            if (isSeparatorRow(cells)) continue;
            if (!headerSkipped) {
                headerSkipped = true;
                continue;
            }
            cb(row.trim(), cells);
        }
    }
}

/**
 * OPT-F3.1: Mapea parámetro de fila (primera celda normalizada) → URLs de fuentes que respaldan el segmento,
 * a partir de `groundingMetadata.groundingSupports` / `groundingChunks` del candidato Gemini.
 */
export function extractRowSourceUrlsFromGrounding(rawMarkdown: string, rawCandidate: any): Map<string, string[]> {
    const map = new Map<string, string[]>();
    const supports: any[] = rawCandidate?.groundingMetadata?.groundingSupports || [];
    const chunks: any[] = rawCandidate?.groundingMetadata?.groundingChunks || [];
    if (!Array.isArray(supports) || supports.length === 0 || !Array.isArray(chunks)) return map;

    const chunkUrl = (idx: number): string | null => {
        const c = chunks[idx];
        const uri = c?.web?.uri || c?.retrievedContext?.uri;
        return typeof uri === 'string' && uri.startsWith('http') ? uri : null;
    };

    const rows: Array<{ key: string; line: string }> = [];
    forEachTableBodyRow(rawMarkdown, (line, cells) => {
        if (cells.length >= 2 && cells[0]) rows.push({ key: normalizeParamKey(cells[0]), line });
    });
    if (rows.length === 0) return map;

    for (const sup of supports) {
        const segText = String(sup?.segment?.text || '').trim();
        const idxs: number[] = Array.isArray(sup?.groundingChunkIndices) ? sup.groundingChunkIndices : [];
        if (segText.length < 6 || idxs.length === 0) continue;
        const urls = idxs.map((n) => chunkUrl(Number(n))).filter((u): u is string => Boolean(u));
        if (urls.length === 0) continue;
        for (const row of rows) {
            if (row.line.includes(segText) || segText.includes(row.line.slice(0, Math.min(60, row.line.length)))) {
                const prev = map.get(row.key) || [];
                map.set(row.key, Array.from(new Set([...prev, ...urls])));
            }
        }
    }
    return map;
}

export function analyzeTableTraceability(
    markdown: string,
    evidenceDocs: EvidenceDocument[],
    groundingRowUrls: Map<string, string[]>,
    resolvedUrlMap: Record<string, string> = {},
    pillarId?: string
): TableTraceAnalysis {
    const index = buildEvidenceIndex(evidenceDocs);
    const rows = new Map<string, RowTraceInfo>();
    const stats = { rows_checked: 0, evidence_verified: 0, grounded_only: 0, untraced: 0 };

    forEachTableBodyRow(markdown, (line, cells) => {
        const targetCellIndex = findPhysicalMeasurementCellIndex(cells, pillarId);
        if (targetCellIndex === -1) return;
        const valueCell = cells[targetCellIndex];
        const groups = discriminatingNumbers(valueCell);
        if (groups.length === 0) return;
        stats.rows_checked++;

        const evidenceUrls: string[] = [];
        for (const doc of index) {
            const found = groups.some((interps) => interps.some((v) => hasValueWithinTolerance(doc.values, v)));
            if (found) evidenceUrls.push(doc.url);
        }
        const groundUrls = (groundingRowUrls.get(normalizeParamKey(cells[0])) || []).map(
            (u) => resolvedUrlMap[u] || u
        );
        const refUrls = Array.from(new Set([...evidenceUrls, ...groundUrls]));
        const evidenceVerified = evidenceUrls.length > 0;
        const untraced = refUrls.length === 0;

        if (evidenceVerified) stats.evidence_verified++;
        else if (!untraced) stats.grounded_only++;
        else stats.untraced++;

        rows.set(line, { refUrls, evidenceVerified, untraced, targetCellIndex });
    });

    return { rows, stats };
}

/** Elimina filas sin trazabilidad para que no alimenten el gráfico determinista de tablas. */
export function stripUntracedRows(markdown: string, analysis: TableTraceAnalysis): string {
    return String(markdown || '')
        .split('\n')
        .filter((l) => !analysis.rows.get(l.trim())?.untraced)
        .join('\n');
}

/**
 * Anota la celda de magnitud física de cada fila con `[F#]` (índice 1-based en `item_sources`) o `[Sin trazabilidad directa]`.
 */
export function applyTraceabilityAnnotations(
    markdown: string,
    analysis: TableTraceAnalysis,
    finalSources: ItemizedSource[]
): string {
    const urlToIndex = new Map<string, number>();
    (finalSources || []).forEach((s, idx) => {
        if (s?.url && !urlToIndex.has(s.url)) urlToIndex.set(s.url, idx + 1);
    });

    return String(markdown || '')
        .split('\n')
        .map((line) => {
            const info = analysis.rows.get(line.trim());
            if (!info) return line;
            const cells = splitRowCells(line);
            const cellIdx = info.targetCellIndex ?? 1;
            if (cells.length <= cellIdx || /\[F\d|sin trazabilidad/i.test(cells[cellIdx])) return line;
            const refs = Array.from(
                new Set(info.refUrls.map((u) => urlToIndex.get(u)).filter((n): n is number => typeof n === 'number'))
            ).sort((a, b) => a - b);
            if (refs.length > 0) {
                cells[cellIdx] = `${cells[cellIdx]} [${refs.map((n) => `F${n}`).join(',')}]`;
            } else if (info.untraced) {
                cells[cellIdx] = `${cells[cellIdx]} ${UNTRACED_ROW_TAG}`;
            } else {
                return line;
            }
            return `| ${cells.join(' | ')} |`;
        })
        .join('\n');
}

