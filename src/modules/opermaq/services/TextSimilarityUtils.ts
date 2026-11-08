/**
 * TEXT SIMILARITY & DETERMINISTIC SPEC EXTRACTION UTILS — OPERMAQ VAULT
 *
 * Módulo centralizado para comparación léxica determinista de capítulos/ítems
 * y extracción quirúrgica de magnitudes y subsistemas confirmados desde Markdown cazado.
 */

export function normalizeComparableTitle(str: string): string {
    return String(str || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function tokenJaccardSimilarity(a: string, b: string): number {
    const tokensA = normalizeComparableTitle(a)
        .split(' ')
        .filter((w) => w.length > 2);
    const tokensB = normalizeComparableTitle(b)
        .split(' ')
        .filter((w) => w.length > 2);
    if (tokensA.length === 0 || tokensB.length === 0) return 0;

    const setA = new Set(tokensA);
    const setB = new Set(tokensB);
    let inter = 0;
    for (const t of setA) {
        if (setB.has(t)) inter++;
    }
    return inter / (setA.size + setB.size - inter);
}

/**
 * Extrae determinísticamente los parámetros, subsistemas y magnitudes verificadas
 * desde el Markdown cazado de un ítem (`it.content`), priorizando filas de tablas técnicas
 * con cifras/unidades y subtítulos `###` para retroalimentar el itemizado de pilares derivados (`CAD-01`)
 * y el contexto de ítems hermanos (`CAD-03`).
 */
export function extractConfirmedSpecsSummaryFromMarkdown(
    markdown: string | undefined,
    maxChars = 320
): string {
    const raw = String(markdown || '').trim();
    if (raw.length < 30) return '';

    const lines = raw.split(/\r?\n/);
    const extractedSegments: string[] = [];

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        // 1. Subtítulos de subsistemas (### Subsistema)
        if (/^#{2,4}\s+/.test(line)) {
            const heading = line
                .replace(/^#{2,4}\s+/, '')
                .replace(/\[sym:[^\]]+\]/gi, '')
                .trim();
            if (heading.length >= 4 && heading.length <= 90) {
                extractedSegments.push(`[Subsistema: ${heading}]`);
            }
            continue;
        }

        // 2. Filas de tablas Markdown con datos técnicos reales
        if (line.startsWith('|') && line.endsWith('|') && !/^\|[\s:|-]+\|$/.test(line)) {
            const cells = line
                .split('|')
                .map((c) =>
                    c
                        .replace(/\[sym:[^\]]+\]/gi, '')
                        .replace(/\[F\d+\]/g, '')
                        .replace(/\*\*/g, '')
                        .trim()
                )
                .filter(Boolean);

            if (cells.length >= 2) {
                const col0 = cells[0].toUpperCase();
                if (
                    col0 === 'PARÁMETRO' ||
                    col0 === 'PARAMETRO' ||
                    col0 === 'N°' ||
                    col0 === 'COMPONENTE' ||
                    col0 === 'PELIGRO / ENERGÍA' ||
                    col0 === 'PUNTO / COMPONENTE DE INSPECCIÓN' ||
                    col0.startsWith('---')
                ) {
                    continue;
                }
                const paramLabel = cells[0].replace(/^\d{1,2}\s*$/, '').trim() || cells[1] || '';
                const valueCandidate =
                    cells[0].match(/^\d{1,2}$/) && cells.length >= 3
                        ? `${cells[1]}: ${cells[2]}`
                        : `${paramLabel}: ${cells[1]}`;
                const cleanedPair = valueCandidate.replace(/\s+/g, ' ').trim();
                if (
                    cleanedPair.length >= 6 &&
                    !/no declarad|pendiente de registro/i.test(cleanedPair)
                ) {
                    extractedSegments.push(cleanedPair);
                }
            }
        }
    }

    if (extractedSegments.length === 0) {
        return raw
            .replace(/\[sym:[^\]]+\]/gi, '')
            .replace(/\[FIGURA_PENDIENTE:[^\]]+\]/gi, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, maxChars);
    }

    const joined = extractedSegments.join(' ; ');
    return joined.length > maxChars ? `${joined.slice(0, maxChars - 1)}…` : joined;
}

